import { promises as fs } from 'fs'
import { dirname } from 'path'
import type { SessionState } from '../shared/contracts'
import { writeFileAtomically } from './atomic-write'

export async function loadSession(filePath: string): Promise<SessionState> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as SessionState
  } catch {
    return { activePath: null, tabs: [], highlightColor: '#fde047', theme: 'system' }
  }
}

export async function saveSession(filePath: string, state: SessionState): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  await writeFileAtomically(filePath, JSON.stringify(state, null, 2))
}
