import fs from 'fs/promises'
import path from 'path'
import { spawnSync } from 'child_process'
import type { ClientAdapter, ClientId, InstallMethod, InstallResult, SkillFile } from '@shared/types'
import { clientIdForDir } from '../clients'
import { hashBundleDir, isLegacySymlink, writeBundleDir } from './bundle'

function commandExists(command: string): boolean {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'command', process.platform === 'win32' ? [command] : ['-v', command], {
    shell: process.platform !== 'win32',
    stdio: 'ignore'
  })
  return res.status === 0
}

function adapterLabel(id: string): string {
  if (id === 'hermes') return 'Hermes'
  if (id === 'claude') return 'Claude'
  if (id === 'claude-desktop') return 'Claude Desktop'
  if (id === 'copilot') return 'Copilot / VS Code'
  if (id === 'npx-skills') return 'npx skills'
  return 'Custom directory'
}

function canonicalClientId(id: string): ClientId {
  if (id === 'claude-desktop') return 'claude'
  if (id === 'hermes' || id === 'claude' || id === 'copilot' || id === 'npx-skills') return id
  return 'custom'
}

export function makeDirectoryAdapter(targetDir: string, forcedId?: string): ClientAdapter {
  const rawId = forcedId ?? clientIdForDir(targetDir)
  const id = canonicalClientId(rawId)
  const method: InstallMethod = 'managed-copy'
  return {
    id,
    displayName: adapterLabel(id),
    targetDir,
    installMethod: method,
    capabilities: {
      nativeInstall: false,
      nativeUpdate: false,
      inspectInstalledBundle: true,
      listInstalledSkills: true,
      importLocalChanges: true
    },
    async detectEnvironment() {
      const parent = path.dirname(targetDir)
      try {
        await fs.mkdir(parent, { recursive: true })
        return { status: 'ok' as const }
      } catch (err) {
        return { status: 'blocked' as const, message: err instanceof Error ? err.message : String(err) }
      }
    },
    async locateInstalledBundle(skillName: string) {
      const skillDir = path.join(targetDir, skillName)
      try {
        const st = await fs.stat(skillDir)
        if (!st.isDirectory()) return null
        return { path: skillDir, inspectable: true, legacySymlink: await isLegacySymlink(skillDir) }
      } catch {
        if (await isLegacySymlink(skillDir)) return { path: skillDir, inspectable: true, legacySymlink: true }
        return null
      }
    },
    async install(skill) {
      return installOrUpdate(targetDir, skill.name, skill.files, method)
    },
    async update(skill) {
      return installOrUpdate(targetDir, skill.name, skill.files, method)
    }
  }
}

async function installOrUpdate(targetDir: string, skillName: string, files: SkillFile[], method: InstallMethod): Promise<InstallResult> {
  await fs.mkdir(targetDir, { recursive: true })
  const installedPath = path.join(targetDir, skillName)
  await writeBundleDir(installedPath, files)
  const installedBundleHash = await hashBundleDir(installedPath)
  return {
    ok: true,
    method,
    installedPath,
    installedBundleHash,
    output: `Installed ${skillName} to ${installedPath}`
  }
}

export function detectCliAdapterStatus(id: ClientId): { status: 'ok' | 'blocked' | 'unsupported'; message?: string } {
  if (id === 'custom') return { status: 'unsupported', message: 'Custom directory targets use managed-copy and have no native CLI.' }
  if (id === 'npx-skills') return commandExists('npx') ? { status: 'ok' } : { status: 'blocked', message: 'npx command is not available.' }
  const command = id === 'claude' ? 'claude' : id === 'copilot' ? 'copilot' : 'hermes'
  return commandExists(command) ? { status: 'ok' } : { status: 'blocked', message: `${command} command is not available.` }
}
