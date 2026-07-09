import { promises as fs } from 'fs'
import { join, sep, dirname, basename } from 'path'
import { shell } from 'electron'
import type { InstallReceipt, LocalSkill, SkillBundle, SkillFile } from '@shared/types'
import { parseSkillMd } from './frontmatter'
import { detectClients, clientIdForDir } from '../clients'
import { downloadSkill } from '../github'
import { getSettings } from '../settings'
import { diffSkillFiles, filterSkillFiles, hashBundleDir, hashSkillFiles, isLegacySymlink, readBundleFiles, writeBundleDir } from './bundle'
import { makeDirectoryAdapter } from './adapters'
import { readReceipt, writeReceipt } from './receipts'

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Recursively read every distributable file in a skill folder into SkillFile[]. */
async function readSkillDir(dir: string): Promise<SkillFile[]> {
  return readBundleFiles(dir)
}

/** Write a skill's files into <targetDir>/<name>/... overwriting in place. */
export async function writeSkillBundle(
  targetDir: string,
  name: string,
  files: SkillFile[]
): Promise<string> {
  const skillDir = join(targetDir, name)
  await writeBundleDir(skillDir, files)
  return skillDir
}

/** Read a single installed skill folder into a full bundle. */
export async function readLocalSkill(dir: string): Promise<SkillBundle> {
  const files = await readSkillDir(dir)
  const skillMd = files.find((f) => f.path === 'SKILL.md')
  const fallbackName = dir.split(sep).pop() || 'skill'
  const meta = parseSkillMd(skillMd?.content ?? '', fallbackName)
  return { meta, files }
}

/** Scan all configured client directories and list installed skills. */
export async function listLocalSkills(): Promise<LocalSkill[]> {
  const clients = detectClients()
  const skills: LocalSkill[] = []

  for (const client of clients) {
    if (!(await exists(client.path))) continue
    const entries = await fs.readdir(client.path, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const dir = join(client.path, entry.name)
      const skillMdPath = join(dir, 'SKILL.md')
      if (!(await exists(skillMdPath))) continue
      const content = await fs.readFile(skillMdPath, 'utf8')
      const meta = parseSkillMd(content, entry.name)
      const installedBundleHash = await hashBundleDir(dir).catch(() => null)
      const receipt = await readReceipt(clientIdForDir(client.path), meta.name)
      const legacy = await isLegacySymlink(dir)
      skills.push({
        ...meta,
        clientId: client.id,
        dir,
        nativeState: legacy ? 'legacy-symlink' : undefined,
        installedBundleHash,
        receipt
      })
    }
  }

  return skills
}

function receiptForInstall(args: {
  client: string
  skill: string
  sourcePath: string
  sourceBundleHash: string
  installMethod: InstallReceipt['installMethod']
  installedPath: string
  installedBundleHash: string | null
  existing?: InstallReceipt | null
}): InstallReceipt {
  const s = getSettings()
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    client: args.client,
    skill: args.skill,
    sourceRepo: s.repoOwner && s.repoName ? `${s.repoOwner}/${s.repoName}` : 'local',
    sourcePath: args.sourcePath,
    sourceRef: s.repoBranch || '',
    sourceCommit: null,
    sourceBundleHash: args.sourceBundleHash,
    installMethod: args.installMethod,
    marketplaceName: null,
    installedPaths: [args.installedPath],
    installedBundleHash: args.installedBundleHash,
    installedAt: args.existing?.installedAt ?? now,
    updatedAt: now
  }
}

async function performAdapterInstall(repoPath: string, targetDir: string, files: SkillFile[], update = false): Promise<string> {
  const filtered = filterSkillFiles(files)
  const skillMd = filtered.find((f) => f.path === 'SKILL.md')
  const name = parseSkillMd(skillMd?.content ?? '', basename(repoPath)).name
  const adapter = makeDirectoryAdapter(targetDir)
  const env = await adapter.detectEnvironment()
  if (env.status !== 'ok') throw new Error(env.message ?? `${adapter.displayName} is ${env.status}`)
  const sourceBundleHash = hashSkillFiles(filtered)
  const result = update
    ? await adapter.update({ name, repoPath, files: filtered })
    : await adapter.install({ name, repoPath, files: filtered })
  if (!result.ok || !result.installedPath) throw new Error(result.error ?? `Install failed for ${name}`)
  if (result.installedBundleHash && result.installedBundleHash !== sourceBundleHash) {
    throw new Error(`Post-install verification failed for ${name}: ${result.installedBundleHash} != ${sourceBundleHash}`)
  }
  const existing = await readReceipt(adapter.id, name)
  await writeReceipt(
    receiptForInstall({
      client: adapter.id,
      skill: name,
      sourcePath: repoPath,
      sourceBundleHash,
      installMethod: result.method,
      installedPath: result.installedPath,
      installedBundleHash: result.installedBundleHash ?? null,
      existing
    })
  )
  return result.installedPath
}

/** Download a repo skill and install it into one or more target directories. */
export async function installRepoSkill(repoPath: string, targetDirs: string[]): Promise<string[]> {
  const files = await downloadSkill(repoPath)
  const installed: string[] = []
  for (const target of targetDirs) {
    installed.push(await performAdapterInstall(repoPath, target, files))
  }
  return installed
}

/** Update an existing installed skill directory from a repo skill and refresh its receipt. */
export async function updateInstalledSkill(repoPath: string, installedDir: string): Promise<string> {
  const files = await downloadSkill(repoPath)
  return performAdapterInstall(repoPath, dirname(installedDir), files, true)
}

/** Write a locally authored skill into one or more target directories. */
export async function saveLocalSkill(
  name: string,
  files: SkillFile[],
  targetDirs: string[]
): Promise<string[]> {
  const installed: string[] = []
  for (const target of targetDirs) {
    installed.push(await performAdapterInstall(name, target, files))
  }
  return installed
}

export async function diffInstalledSkillAgainstSource(repoPath: string, installedDir: string): Promise<{ text: string; added: string[]; removed: string[]; changed: string[] }> {
  const [sourceFiles, installedFiles] = await Promise.all([downloadSkill(repoPath), readBundleFiles(installedDir)])
  return diffSkillFiles(sourceFiles, installedFiles)
}

export async function adoptInstalledSkillIntoSource(repoPath: string, installedDir: string): Promise<{ adoptedPath: string; files: string[] }> {
  const settings = getSettings()
  if (!settings.repoDir) throw new Error('Adopting local changes requires Settings > local checkout mode (repoDir).')
  const sourceDir = join(settings.repoDir, repoPath)
  const files = await readBundleFiles(installedDir)
  await writeBundleDir(sourceDir, files)
  return { adoptedPath: sourceDir, files: files.map((f) => f.path) }
}

/** Open a skill folder in the OS file manager. */
export async function openSkillDir(dir: string): Promise<void> {
  await shell.openPath(dir)
}

export { clientIdForDir }
