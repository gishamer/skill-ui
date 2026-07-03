import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { AppSettings, ClientTarget, SkillBundle } from '@shared/types'

export type PageId = 'browse' | 'installed' | 'create' | 'edit' | 'settings'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastInput {
  kind: ToastKind
  message: ReactNode
  /** ms before auto-dismiss; 0 keeps it until closed. */
  timeout?: number
}

/** Params passed when navigating to the Edit page. */
export interface EditRouteParams {
  /** Pre-loaded skill bundle to edit. */
  bundle: SkillBundle
  /** Origin: a locally installed skill (with its folder) or repo download. */
  source: 'local' | 'repo'
  /** For local edits, the originating folder so we can detect target client. */
  dir?: string
}

export interface AppContextValue {
  settings: AppSettings
  clients: ClientTarget[]
  configured: boolean
  refreshSettings: () => Promise<void>
  refreshClients: () => Promise<void>
  toast: (t: ToastInput) => void
  navigate: (page: PageId, params?: EditRouteParams) => void
  routeParams: EditRouteParams | null
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppContext')
  return ctx
}
