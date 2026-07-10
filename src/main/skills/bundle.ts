import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { SkillFile } from '@shared/types'
import { getSettings } from '../settings'

export const BUNDLE_EXCLUDED_NAMES = new Set([
  '.git',
  '.loop',
  'node_modules',
  'out',
  'dist',
  'evals',
  'docs',
  'schemas',
  '.github',
  '.claude-plugin',
  '.DS_Store',
  'skills.lock.yaml',
  'skills.sh.json'
])

export interface BundleFileOnDisk {
  path: string
  absolutePath: string
}

export interface BundleDiff {
  added: string[]
  removed: string[]
  changed: string[]
  text: string
}

function posixRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/')
}

function shouldExclude(relativePath: string): boolean {
  const configuredExcludes = new Set(getSettings().repoConventions.bundleExcludeNames)
  return relativePath.split('/').some((part) => BUNDLE_EXCLUDED_NAMES.has(part) || configuredExcludes.has(part))
}

function pathCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function filterSkillFiles(files: SkillFile[]): SkillFile[] {
  return files
    .filter((file) => file.path && !shouldExclude(file.path.split(path.sep).join('/')))
    .map((file) => ({ ...file, path: file.path.split(path.sep).join('/') }))
    .sort((a, b) => pathCompare(a.path, b.path))
}

export async function enumerateBundleFiles(root: string): Promise<BundleFileOnDisk[]> {
  const out: BundleFileOnDisk[] = []
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      const rel = posixRelative(root, absolutePath)
      if (shouldExclude(rel)) continue
      if (entry.isDirectory()) {
        await walk(absolutePath)
      } else if (entry.isFile()) {
        out.push({ path: rel, absolutePath })
      }
    }
  }
  await walk(root)
  return out.sort((a, b) => pathCompare(a.path, b.path))
}

export async function readBundleFiles(root: string): Promise<SkillFile[]> {
  const files = await enumerateBundleFiles(root)
  const out: SkillFile[] = []
  for (const file of files) {
    const buf = await fs.readFile(file.absolutePath)
    out.push(
      buf.includes(0)
        ? { path: file.path, content: buf.toString('base64'), encoding: 'base64' }
        : { path: file.path, content: buf.toString('utf8'), encoding: 'utf8' }
    )
  }
  return out
}

function bytesForSkillFile(file: SkillFile): Buffer {
  return file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8')
}

export function hashSkillFiles(files: SkillFile[]): string {
  const hash = createHash('sha256')
  for (const file of filterSkillFiles(files)) {
    hash.update(file.path, 'utf8')
    hash.update(Buffer.from([0]))
    hash.update(bytesForSkillFile(file))
    hash.update(Buffer.from([0]))
  }
  return `sha256:${hash.digest('hex')}`
}

export async function hashBundleDir(root: string): Promise<string> {
  return hashSkillFiles(await readBundleFiles(root))
}

export async function writeBundleDir(skillDir: string, files: SkillFile[]): Promise<void> {
  try {
    const st = await fs.lstat(skillDir)
    if (st.isSymbolicLink()) throw new Error(`Refusing to overwrite legacy symlink install: ${skillDir}`)
    await fs.rm(skillDir, { recursive: true, force: true })
  } catch (err) {
    if (!(typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT')) throw err
  }
  await fs.mkdir(skillDir, { recursive: true })
  const root = path.resolve(skillDir)
  for (const file of filterSkillFiles(files)) {
    const dest = path.join(skillDir, file.path)
    const resolved = path.resolve(dest)
    if (!(resolved === root || resolved.startsWith(root + path.sep))) {
      throw new Error(`Refusing to write bundle file outside skill directory: ${file.path}`)
    }
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, bytesForSkillFile(file))
  }
}

export async function isLegacySymlink(p: string): Promise<boolean> {
  try {
    return (await fs.lstat(p)).isSymbolicLink()
  } catch {
    return false
  }
}

export function diffSkillFiles(base: SkillFile[], other: SkillFile[]): BundleDiff {
  const left = new Map(filterSkillFiles(base).map((file) => [file.path, file]))
  const right = new Map(filterSkillFiles(other).map((file) => [file.path, file]))
  const all = Array.from(new Set([...left.keys(), ...right.keys()])).sort(pathCompare)
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  const lines: string[] = []
  for (const file of all) {
    const l = left.get(file)
    const r = right.get(file)
    if (!l && r) {
      added.push(file)
      lines.push(`A ${file}`)
    } else if (l && !r) {
      removed.push(file)
      lines.push(`D ${file}`)
    } else if (l && r && (l.encoding !== r.encoding || l.content !== r.content)) {
      changed.push(file)
      lines.push(`M ${file}`)
    }
  }
  return { added, removed, changed, text: lines.join('\n') }
}
