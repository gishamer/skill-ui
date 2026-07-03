import { promises as fs } from 'fs'
import { join, relative, sep, dirname } from 'path'
import { shell } from 'electron'
import type { LocalSkill, SkillBundle, SkillFile } from '@shared/types'
import { parseSkillMd } from './frontmatter'
import { detectClients, clientIdForDir } from '../clients'
import { downloadSkill } from '../github'

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

const IGNORED_SKILL_DIR_ENTRIES = new Set(['.git', 'node_modules', '.DS_Store'])

/** Recursively read every file in a skill folder into SkillFile[]. */
async function readSkillDir(dir: string): Promise<SkillFile[]> {
  const out: SkillFile[] = []
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (IGNORED_SKILL_DIR_ENTRIES.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        const buf = await fs.readFile(full)
        const rel = relative(dir, full).split(sep).join('/')
        if (buf.includes(0)) {
          out.push({ path: rel, content: buf.toString('base64'), encoding: 'base64' })
        } else {
          out.push({ path: rel, content: buf.toString('utf8'), encoding: 'utf8' })
        }
      }
    }
  }
  await walk(dir)
  return out
}

/** Write a skill's files into <targetDir>/<name>/... overwriting in place. */
export async function writeSkillBundle(
  targetDir: string,
  name: string,
  files: SkillFile[]
): Promise<string> {
  const skillDir = join(targetDir, name)
  await fs.mkdir(skillDir, { recursive: true })
  for (const file of files) {
    const dest = join(skillDir, file.path)
    await fs.mkdir(dirname(dest), { recursive: true })
    const data =
      file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8')
    await fs.writeFile(dest, data)
  }
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
      if (!entry.isDirectory()) continue
      const dir = join(client.path, entry.name)
      const skillMdPath = join(dir, 'SKILL.md')
      if (!(await exists(skillMdPath))) continue
      const content = await fs.readFile(skillMdPath, 'utf8')
      const meta = parseSkillMd(content, entry.name)
      skills.push({ ...meta, clientId: client.id, dir })
    }
  }

  return skills
}

/** Download a repo skill and install it into one or more target directories. */
export async function installRepoSkill(repoPath: string, targetDirs: string[]): Promise<string[]> {
  const files = await downloadSkill(repoPath)
  const name = repoPath.split('/').pop() || 'skill'
  const installed: string[] = []
  for (const target of targetDirs) {
    installed.push(await writeSkillBundle(target, name, files))
  }
  return installed
}

/** Write a locally authored skill into one or more target directories. */
export async function saveLocalSkill(
  name: string,
  files: SkillFile[],
  targetDirs: string[]
): Promise<string[]> {
  const installed: string[] = []
  for (const target of targetDirs) {
    installed.push(await writeSkillBundle(target, name, files))
  }
  return installed
}

/** Open a skill folder in the OS file manager. */
export async function openSkillDir(dir: string): Promise<void> {
  await shell.openPath(dir)
}

export { clientIdForDir }
