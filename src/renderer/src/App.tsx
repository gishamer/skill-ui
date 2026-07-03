import { useCallback, useEffect, useState } from 'react'
import {
  Package,
  HardDrive,
  PlusCircle,
  Pencil,
  Settings as SettingsIcon,
  X,
  Boxes
} from 'lucide-react'
import type { AppSettings, ClientTarget } from '@shared/types'
import { api } from './api'
import {
  AppContext,
  type AppContextValue,
  type EditRouteParams,
  type PageId,
  type ToastInput
} from './context'
import { Loading } from './components/Spinner'
import BrowsePage from './pages/BrowsePage'
import InstalledPage from './pages/InstalledPage'
import CreatePage from './pages/CreatePage'
import EditPage from './pages/EditPage'
import SettingsPage from './pages/SettingsPage'

interface ToastItem extends ToastInput {
  id: number
}

const NAV: { id: PageId; label: string; icon: typeof Package }[] = [
  { id: 'browse', label: 'Repository', icon: Package },
  { id: 'installed', label: 'Installed', icon: HardDrive },
  { id: 'create', label: 'Create', icon: PlusCircle },
  { id: 'edit', label: 'Edit', icon: Pencil },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [clients, setClients] = useState<ClientTarget[]>([])
  const [page, setPage] = useState<PageId>('browse')
  const [routeParams, setRouteParams] = useState<EditRouteParams | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const refreshSettings = useCallback(async () => {
    setSettings(await api.settings.get())
  }, [])

  const refreshClients = useCallback(async () => {
    setClients(await api.clients.detect())
  }, [])

  useEffect(() => {
    refreshSettings()
    refreshClients()
  }, [refreshSettings, refreshClients])

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback(
    (input: ToastInput) => {
      const id = Date.now() + Math.random()
      setToasts((t) => [...t, { ...input, id }])
      const timeout = input.timeout ?? 4500
      if (timeout > 0) setTimeout(() => dismiss(id), timeout)
    },
    [dismiss]
  )

  const navigate = useCallback((p: PageId, params?: EditRouteParams) => {
    setRouteParams(params ?? null)
    setPage(p)
  }, [])

  if (!settings) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <Loading label="Starting Skill UI…" />
      </div>
    )
  }

  const configured = !!((settings.hasToken || settings.repoDir) && settings.repoOwner && settings.repoName)

  const ctx: AppContextValue = {
    settings,
    clients,
    configured,
    refreshSettings,
    refreshClients,
    toast,
    navigate,
    routeParams
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <span className="logo">
              <Boxes size={17} />
            </span>
            Skill UI
          </div>
          <nav className="nav">
            {NAV.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  className={`nav-item ${page === item.id ? 'active' : ''}`}
                  onClick={() => navigate(item.id, item.id === 'edit' ? routeParams ?? undefined : undefined)}
                >
                  <Icon size={17} />
                  {item.label}
                </button>
              )
            })}
          </nav>
          <div className="sidebar-footer">
            {configured ? (
              <span>
                {settings.repoOwner}/{settings.repoName}
              </span>
            ) : (
              <span>Not connected</span>
            )}
          </div>
        </aside>

        <main className="main">
          {page === 'browse' && <BrowsePage />}
          {page === 'installed' && <InstalledPage />}
          {page === 'create' && <CreatePage />}
          {page === 'edit' && <EditPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <div className="toast-body">{t.message}</div>
            <button className="toast-close" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  )
}
