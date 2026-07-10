import { contextBridge, ipcRenderer } from 'electron'
import type {
  SkillUiApi,
  AppSettings,
  InstallArgs,
  SaveLocalArgs,
  UploadArgs,
  UpdateArgs,
  RemoteSkillArgs,
  ScaffoldSkillArgs
} from '@shared/types'

const api: SkillUiApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<AppSettings> & { token?: string }) =>
      ipcRenderer.invoke('settings:set', patch),
    testConnection: () => ipcRenderer.invoke('settings:testConnection')
  },
  clients: {
    detect: () => ipcRenderer.invoke('clients:detect'),
    pickDirectory: () => ipcRenderer.invoke('clients:pickDirectory')
  },
  repo: {
    list: () => ipcRenderer.invoke('repo:list'),
    read: (repoPath: string) => ipcRenderer.invoke('repo:read', repoPath),
    doctor: () => ipcRenderer.invoke('repo:doctor')
  },
  remote: {
    import: (args: RemoteSkillArgs) => ipcRenderer.invoke('remote:import', args)
  },
  local: {
    list: () => ipcRenderer.invoke('local:list'),
    checkUpdates: () => ipcRenderer.invoke('local:checkUpdates'),
    read: (dir: string) => ipcRenderer.invoke('local:read', dir),
    openDir: (dir: string) => ipcRenderer.invoke('local:openDir', dir)
  },
  skills: {
    install: (args: InstallArgs) => ipcRenderer.invoke('skills:install', args),
    scaffold: (args: string | ScaffoldSkillArgs) =>
      ipcRenderer.invoke('skills:scaffold', args),
    validate: (args) => ipcRenderer.invoke('skills:validate', args),
    saveLocal: (args: SaveLocalArgs) => ipcRenderer.invoke('skills:saveLocal', args),
    upload: (args: UploadArgs) => ipcRenderer.invoke('skills:upload', args),
    update: (args: UpdateArgs) => ipcRenderer.invoke('skills:update', args),
    diffInstalled: (args) => ipcRenderer.invoke('skills:diffInstalled', args),
    adoptLocal: (args) => ipcRenderer.invoke('skills:adoptLocal', args)
  }
}

contextBridge.exposeInMainWorld('api', api)
