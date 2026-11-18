import { promises as fs } from 'fs'
import { dirname } from 'path'
import type { SessionState } from '../shared/contracts'
import { defaultHighlightStyle } from '../shared/highlight'
import { writeFileAtomically } from './atomic-write'

export async function loadSession(filePath: string): Promise<SessionState> {
  const defaults: SessionState = {
    activePath: null,
    tabs: [],
    highlightColor: defaultHighlightStyle.color,
    highlightOpacity: defaultHighlightStyle.opacity,
    highlightThickness: defaultHighlightStyle.thickness,
    theme: 'system'
  }
  try {
    const session = JSON.parse(await fs.readFile(filePath, 'utf8')) as SessionState
    return {
      ...defaults,
      ...session,
      highlightColor:
        typeof session.highlightColor === 'string' && /^#[0-9a-f]{6}$/i.test(session.highlightColor)
          ? session.highlightColor
          : defaults.highlightColor,
      highlightOpacity:
        Number.isFinite(session.highlightOpacity) &&
        session.highlightOpacity >= 0.1 &&
        session.highlightOpacity <= 1
          ? session.highlightOpacity
          : defaults.highlightOpacity,
      highlightThickness:
        Number.isInteger(session.highlightThickness) &&
        session.highlightThickness >= 2 &&
        session.highlightThickness <= 40
          ? session.highlightThickness
          : defaults.highlightThickness
    }
  } catch {
    return defaults
  }
}

export async function saveSession(filePath: string, state: SessionState): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  await writeFileAtomically(filePath, JSON.stringify(state, null, 2))
}
