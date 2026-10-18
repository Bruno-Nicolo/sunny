import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AiProvider,
  AiSettings,
  ChatDocument,
  Conversation,
  ConversationSummary,
  DocumentSource
} from '../../shared/ai'

export const defaultAiSettings: AiSettings = {
  consent: false,
  panelWidth: 380,
  provider: 'chatgpt',
  models: {}
}

export class ChatStore {
  private db: DatabaseSync

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(join(directory, 'chat.sqlite'))
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (version TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, pages INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS document_paths (path TEXT PRIMARY KEY, version TEXT NOT NULL REFERENCES documents(version), name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (rowid INTEGER PRIMARY KEY, version TEXT NOT NULL REFERENCES documents(version), id TEXT NOT NULL, page INTEGER NOT NULL, text TEXT NOT NULL, rects TEXT NOT NULL, UNIQUE(version,id));
      CREATE VIRTUAL TABLE IF NOT EXISTS source_search USING fts5(text, content=sources, content_rowid=rowid, tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS sources_insert AFTER INSERT ON sources BEGIN INSERT INTO source_search(rowid,text) VALUES(new.rowid,new.text); END;
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, path TEXT NOT NULL, updated INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS conversation_path ON conversations(path,updated DESC);
    `)
    // A process exit during streaming leaves an explicitly interrupted answer.
    for (const row of this.db
      .prepare(
        `SELECT json FROM conversations WHERE EXISTS (SELECT 1 FROM json_each(conversations.json, '$.messages') WHERE json_extract(value, '$.status')='streaming')`
      )
      .all()) {
      const chat = JSON.parse(String(row.json)) as Conversation
      let changed = false
      for (const message of chat.messages) {
        if (message.status === 'streaming') {
          message.status = 'stopped'
          changed = true
        }
      }
      if (changed) this.save(chat)
    }
  }

  settings(): AiSettings {
    const row = this.db.prepare('SELECT json FROM settings WHERE id=1').get()
    return row ? JSON.parse(String(row.json)) : { ...defaultAiSettings, models: {} }
  }
  setSettings(settings: AiSettings): void {
    this.db.prepare('INSERT OR REPLACE INTO settings VALUES(1,?)').run(JSON.stringify(settings))
  }
  index(document: ChatDocument): void {
    const existing = this.db
      .prepare('SELECT version FROM documents WHERE version=?')
      .get(document.version)
    if (existing) {
      this.db
        .prepare('INSERT OR REPLACE INTO document_paths VALUES(?,?,?)')
        .run(document.path, document.version, document.name)
      return
    }
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('INSERT INTO documents VALUES(?,?,?,?)')
        .run(document.version, document.name, document.path, document.pages)
      this.db
        .prepare('INSERT OR REPLACE INTO document_paths VALUES(?,?,?)')
        .run(document.path, document.version, document.name)
      const insert = this.db.prepare(
        'INSERT INTO sources(version,id,page,text,rects) VALUES(?,?,?,?,?)'
      )
      for (const source of document.sources)
        insert.run(
          document.version,
          source.id,
          source.page,
          source.text,
          JSON.stringify(source.rects)
        )
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  document(version: string): { name: string; path: string; pages: number } {
    const row = this.db
      .prepare('SELECT name,path,pages FROM documents WHERE version=?')
      .get(version)
    if (!row) throw new Error('Index this PDF before starting a conversation.')
    return { name: String(row.name), path: String(row.path), pages: Number(row.pages) }
  }
  private source(row: Record<string, unknown>): DocumentSource {
    return {
      id: String(row.id),
      page: Number(row.page),
      text: String(row.text),
      rects: JSON.parse(String(row.rects))
    }
  }
  sources(version: string): DocumentSource[] {
    return this.db
      .prepare('SELECT id,page,text,rects FROM sources WHERE version=? ORDER BY page,rowid')
      .all(version)
      .map((row) => this.source(row))
  }
  search(version: string, queries: string[]): DocumentSource[] {
    const tokens = [
      ...new Set(
        queries
          .join(' ')
          .normalize('NFKC')
          .match(/[\p{L}\p{N}]{2,}/gu) ?? []
      )
    ].slice(0, 48)
    if (!tokens.length) return []
    const query = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ')
    const matches = this.db
      .prepare(
        `SELECT s.id,s.page,s.text,s.rects FROM source_search f JOIN sources s ON s.rowid=f.rowid WHERE source_search MATCH ? AND s.version=? ORDER BY bm25(source_search) LIMIT 16`
      )
      .all(query, version)
    const result = new Map<string, DocumentSource>()
    for (const row of matches) {
      const hit = this.source(row)
      result.set(hit.id, hit)
    }
    for (const row of matches) {
      const hit = this.source(row)
      const nearby = this.db
        .prepare(
          'SELECT id,page,text,rects FROM sources WHERE version=? AND page BETWEEN ? AND ? ORDER BY page,rowid LIMIT 8'
        )
        .all(version, Math.max(1, hit.page - 1), hit.page + 1)
      for (const neighbor of nearby) {
        const source = this.source(neighbor)
        result.set(source.id, source)
      }
    }
    return [...result.values()]
  }
  list(path: string): ConversationSummary[] {
    return this.db
      .prepare(
        `SELECT id,path,updated,json_extract(json,'$.documentVersion') AS version,json_extract(json,'$.documentName') AS name,json_extract(json,'$.provider') AS provider,json_extract(json,'$.title') AS title FROM conversations WHERE path=? AND json_array_length(json,'$.messages') > 0 ORDER BY updated DESC`
      )
      .all(path)
      .map((row) => {
        return {
          id: String(row.id),
          documentPath: String(row.path),
          updatedAt: Number(row.updated),
          documentVersion: String(row.version),
          documentName: String(row.name),
          provider: row.provider as AiProvider,
          title: String(row.title)
        }
      })
  }
  get(id: string): Conversation {
    const row = this.db.prepare('SELECT json FROM conversations WHERE id=?').get(id)
    if (!row) throw new Error('Conversation not found.')
    return JSON.parse(String(row.json))
  }
  create(
    version: string,
    provider: AiProvider,
    path: string,
    id: string = randomUUID()
  ): Conversation {
    if (this.db.prepare('SELECT 1 FROM conversations WHERE id=?').get(id))
      throw new Error('Conversation already exists.')
    this.document(version)
    const document = this.db
      .prepare('SELECT name,version FROM document_paths WHERE path=?')
      .get(path)
    if (!document || document.version !== version)
      throw new Error('Index the current PDF version before starting a conversation.')
    const conversation: Conversation = {
      id,
      documentVersion: version,
      documentName: String(document.name),
      documentPath: path,
      provider,
      title: 'New chat',
      updatedAt: Date.now(),
      messages: []
    }
    return conversation
  }
  save(conversation: Conversation): void {
    if (!conversation.messages.some((message) => message.role === 'user'))
      throw new Error('A conversation requires a user message.')
    this.db
      .prepare('INSERT OR REPLACE INTO conversations VALUES(?,?,?,?)')
      .run(
        conversation.id,
        conversation.documentPath,
        conversation.updatedAt,
        JSON.stringify(conversation)
      )
  }
  rename(id: string, title: string): void {
    const chat = this.get(id)
    chat.title = title.trim().slice(0, 120) || 'New chat'
    this.save(chat)
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM conversations WHERE id=?').run(id)
  }
  close(): void {
    this.db.close()
  }
}
