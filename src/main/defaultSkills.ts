import { promises as fs, existsSync } from 'fs'
import { join, relative, sep, resolve } from 'path'
import { app } from 'electron'
import type { RepoSkill, SkillBundle, SkillFile } from '@shared/types'
import { parseSkillMd } from './skills/frontmatter'

const BUNDLED_PREFIX = 'builtin/'
const BUNDLED_DIR = 'bundled-skills'
const IGNORED_SKILL_DIR_ENTRIES = new Set(['.git', 'node_modules', '.DS_Store'])

function appRoot(): string {
  const candidates = [
    app.isPackaged ? app.getAppPath() : process.cwd(),
    resolve(__dirname, '..', '..'),
    resolve(__dirname, '..')
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, BUNDLED_DIR))) return candidate
  }
  return app.isPackaged ? app.getAppPath() : process.cwd()
}

function bundledRoot(): string {
  return join(appRoot(), BUNDLED_DIR)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function normalizeBundledName(nameOrPath: string): string | null {
  if (nameOrPath.startsWith(BUNDLED_PREFIX)) return nameOrPath.slice(BUNDLED_PREFIX.length)
  return null
}

export function isBundledSkillPath(repoPath: string): boolean {
  return repoPath.startsWith(BUNDLED_PREFIX)
}

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

export async function listBundledSkills(): Promise<RepoSkill[]> {
  const root = bundledRoot()
  if (!(await exists(root))) return []

  const entries = await fs.readdir(root, { withFileTypes: true })
  const skills: RepoSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const skillMdPath = join(dir, 'SKILL.md')
    if (!(await exists(skillMdPath))) continue
    const content = await fs.readFile(skillMdPath, 'utf8')
    const meta = parseSkillMd(content, entry.name)
    skills.push({ ...meta, repoPath: `${BUNDLED_PREFIX}${entry.name}` })
  }
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return skills
}

export async function downloadBundledSkill(repoPathOrName: string): Promise<SkillFile[]> {
  const bundledName = normalizeBundledName(repoPathOrName) ?? repoPathOrName
  const dir = join(bundledRoot(), bundledName)
  if (!(await exists(join(dir, 'SKILL.md')))) {
    throw new Error(`No bundled skill found for "${repoPathOrName}".`)
  }
  return readSkillDir(dir)
}

export async function readBundledSkill(repoPathOrName: string): Promise<SkillBundle> {
  const files = await downloadBundledSkill(repoPathOrName)
  const skillMd = files.find((f) => f.path === 'SKILL.md')
  const fallbackName = normalizeBundledName(repoPathOrName) ?? repoPathOrName.split('/').pop() ?? 'skill'
  const meta = parseSkillMd(skillMd?.content ?? '', fallbackName)
  return { meta, files }
}
