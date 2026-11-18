import { useEffect } from 'react'
import type { HighlightStyle } from '../../../../shared/highlight'
import type { SessionState } from '../../../../shared/contracts'
import { createTab, type DocumentsState } from '@/features/documents/documentsReducer'
import type { Tab } from '@/features/documents/types'

export type SessionPreferences = {
  highlightStyle: HighlightStyle
  theme: SessionState['theme']
}

export function persistDocumentSession(
  { tabs, activeId, ready }: DocumentsState,
  preferences: SessionPreferences
): Promise<void> {
  if (!ready) return Promise.resolve()
  return window.lepis.saveSession({
    activePath: tabs.find((tab) => tab.id === activeId)?.path ?? null,
    tabs: tabs.map((tab) => ({
      path: tab.path,
      page: tab.view.page,
      scale: tab.view.scale,
      scrollTop: tab.view.scrollTop
    })),
    highlightColor: preferences.highlightStyle.color,
    highlightOpacity: preferences.highlightStyle.opacity,
    highlightThickness: preferences.highlightStyle.thickness,
    theme: preferences.theme
  })
}

type Options = DocumentsState &
  SessionPreferences & {
    restoreSession(tabs: Tab[], activePath: string | null): void
    restorePreferences(session: SessionState): void
    showMessage(message: string): void
  }

export function useDocumentSession({
  tabs,
  activeId,
  ready,
  highlightStyle,
  theme,
  restoreSession,
  restorePreferences,
  showMessage
}: Options): void {
  useEffect(() => {
    let cancelled = false
    const restore = async (): Promise<void> => {
      try {
        const session = await window.lepis.loadSession()
        const results = await Promise.allSettled(
          session.tabs.map(async (saved) =>
            createTab(await window.lepis.readPdf(saved.path), saved)
          )
        )
        const restored = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        )
        if (cancelled) return
        restorePreferences(session)
        restoreSession(restored, session.activePath)
      } catch (error) {
        if (cancelled) return
        showMessage(error instanceof Error ? error.message : 'The session could not be restored.')
        restoreSession([], null)
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [restorePreferences, restoreSession, showMessage])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      void persistDocumentSession({ tabs, activeId, ready }, { highlightStyle, theme }).catch(
        (error: unknown) => {
          showMessage(error instanceof Error ? error.message : 'The session could not be saved.')
        }
      )
    }, 250)
    return () => clearTimeout(timer)
  }, [activeId, highlightStyle, ready, showMessage, tabs, theme])
}
