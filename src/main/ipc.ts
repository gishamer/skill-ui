import { ipcMain, dialog, BrowserWindow } from 'electron'
import type {
  IpcResult,
  InstallArgs,
  SaveLocalArgs,
  UploadArgs,
  UpdateArgs,
  AppSettings,
  SkillFile
} from '@shared/types'
import { getSettings, setSettings } from './settings'
import { detectClients } from './clients'
import { testConnection, listRepoSkills, readRepoSkill, uploadSkillAsPR, doctorRepo } from './github'
import {
  listLocalSkills,
  readLocalSkill,
  installRepoSkill,
  saveLocalSkill,
  openSkillDir,
  diffInstalledSkillAgainstSource,
  adoptInstalledSkillIntoSource
} from './skills/local'
import { scaffoldSkill } from './skills/create'
import { checkUpdates, updateSkills } from './skills/update'
import { validateSkillBundle } from './skills/validate'
import { importRemoteSkill } from './remote'

/** Run an async function and wrap the outcome in an IpcResult. */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerIpc(): void {
  // ---- settings ----
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings> & { token?: string }) =>
    setSettings(patch)
  )
  ipcMain.handle('settings:testConnection', () => wrap(() => testConnection()))

  // ---- clients ----
  ipcMain.handle('clients:detect', () => detectClients())
  ipcMain.handle('clients:pickDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select skills directory',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ---- repository ----
  ipcMain.handle('repo:list', () => wrap(() => listRepoSkills()))
  ipcMain.handle('repo:read', (_e, repoPath: string) => wrap(() => readRepoSkill(repoPath)))
  ipcMain.handle('repo:doctor', () => wrap(() => doctorRepo()))

  // ---- remote imports / public mirrors ----
  ipcMain.handle('remote:import', (_e, args) => wrap(() => importRemoteSkill(args)))

  // ---- local ----
  ipcMain.handle('local:list', () => wrap(() => listLocalSkills()))
  ipcMain.handle('local:checkUpdates', () => wrap(() => checkUpdates()))
  ipcMain.handle('local:read', (_e, dir: string) => wrap(() => readLocalSkill(dir)))
  ipcMain.handle('local:openDir', (_e, dir: string) => openSkillDir(dir))

  // ---- skill actions ----
  ipcMain.handle('skills:install', (_e, args: InstallArgs) =>
    wrap(async () => ({ installed: await installRepoSkill(args.repoPath, args.targetDirs) }))
  )
  ipcMain.handle('skills:scaffold', (_e, args: string | { name: string; owner?: string; lifecycle?: string }) =>
    wrap(() => scaffoldSkill(args))
  )
  ipcMain.handle('skills:validate', (_e, args: { name: string; files: SkillFile[] }) =>
    wrap(async () => validateSkillBundle(args.name, args.files))
  )
  ipcMain.handle('skills:saveLocal', (_e, args: SaveLocalArgs) =>
    wrap(async () => ({ installed: await saveLocalSkill(args.name, args.files, args.targetDirs) }))
  )
  ipcMain.handle('skills:upload', (_e, args: UploadArgs) =>
    wrap(() => uploadSkillAsPR(args.name, args.files, args.note))
  )
  ipcMain.handle('skills:update', (_e, args: UpdateArgs) => wrap(() => updateSkills(args)))
  ipcMain.handle('skills:diffInstalled', (_e, args: { repoPath: string; dir: string }) =>
    wrap(() => diffInstalledSkillAgainstSource(args.repoPath, args.dir))
  )
  ipcMain.handle('skills:adoptLocal', (_e, args: { repoPath: string; dir: string }) =>
    wrap(() => adoptInstalledSkillIntoSource(args.repoPath, args.dir))
  )
}
