import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { Octokit } from '@octokit/rest'
import type { RepoSkill, SkillBundle, SkillFile, UploadResult, RepoDoctorReport } from '@shared/types'
import { getSettings, getToken } from './settings'
import { parseSkillMd } from './skills/frontmatter'
import { validateSkillBundle } from './skills/validate'
import {
  downloadBundledSkill,
  isBundledSkillPath,
  listBundledSkills,
  readBundledSkill
} from './defaultSkills'

function repoPathJoin(...parts: string[]): string {
  return parts
    .filter((p) => p !== '')
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
}

class GitHubError extends Error {}

function isGitHubNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && err.status === 404
}

function branchNotFoundMessage(owner: string, repo: string, branch: string): string {
  return [
    `Branch "${branch}" was not found in ${owner}/${repo}.`,
    'If this is a new repository, initialize it first by adding a README or creating the first commit on GitHub.',
    'If the repository already has commits, update the Branch setting to the exact branch name and try again.'
  ].join(' ')
}

function client(): Octokit {
  const token = getToken()
  if (!token) {
    throw new GitHubError(
      'No GitHub token configured. Add a personal access token in Settings.'
    )
  }
  return new Octokit({
    auth: token,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
  })
}

function repoCoords(): { owner: string; repo: string; branch: string; skillsPath: string; repoDir: string } {
  const s = getSettings()
  if (!s.repoOwner || !s.repoName) {
    throw new GitHubError('Skill repository is not configured. Set it in Settings.')
  }
  return { owner: s.repoOwner, repo: s.repoName, branch: s.repoBranch || 'main', skillsPath: s.repoSkillsPath, repoDir: s.repoDir }
}

/** Verify the token works and return the authenticated login. */
export async function testConnection(): Promise<{ login: string }> {
  const { owner, repo, branch, repoDir } = repoCoords()
  if (repoDir) {
    const root = path.resolve(repoDir)
    if (!fsSync.existsSync(root) || !fsSync.statSync(root).isDirectory()) {
      throw new GitHubError(`Local repository directory does not exist: ${root}`)
    }
    return { login: `local:${root}` }
  }
  const octokit = client()
  const { data } = await octokit.users.getAuthenticated()
  // Also confirm we can see the configured repo and branch.
  await octokit.repos.get({ owner, repo })
  await getBranch(octokit, owner, repo, branch)
  return { login: data.login }
}

async function getBranch(octokit: Octokit, owner: string, repo: string, branch: string) {
  try {
    const { data } = await octokit.repos.getBranch({ owner, repo, branch })
    return data
  } catch (err) {
    if (isGitHubNotFound(err)) {
      throw new GitHubError(branchNotFoundMessage(owner, repo, branch))
    }
    throw err
  }
}

/** Resolve the tree sha for the configured branch. */
async function getTreeSha(octokit: Octokit, owner: string, repo: string, branch: string): Promise<string> {
  const data = await getBranch(octokit, owner, repo, branch)
  return data.commit.commit.tree.sha
}

function decodeBlob(base64: string): { content: string; encoding: 'utf8' | 'base64' } {
  const buf = Buffer.from(base64, 'base64')
  if (buf.includes(0)) return { content: base64, encoding: 'base64' }
  return { content: buf.toString('utf8'), encoding: 'utf8' }
}

async function readJsonFileIfExists(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') return null
    throw err
  }
}

function pluginSources(manifest: unknown): Map<string, string> {
  const map = new Map<string, string>()
  const plugins = typeof manifest === 'object' && manifest !== null && 'plugins' in manifest && Array.isArray(manifest.plugins)
    ? manifest.plugins
    : []
  for (const plugin of plugins) {
    if (typeof plugin === 'object' && plugin !== null && 'name' in plugin && typeof plugin.name === 'string') {
      const source = 'source' in plugin && typeof plugin.source === 'string' ? plugin.source.replace(/^\.\//, '') : ''
      map.set(plugin.name, source)
    }
  }
  return map
}

interface LocalRepoContext {
  root: string
  claudePlugins: Map<string, string>
  copilotPlugins: Map<string, string>
}

async function localRepoContext(repoDir: string): Promise<LocalRepoContext> {
  const root = path.resolve(repoDir)
  if (!fsSync.existsSync(root) || !fsSync.statSync(root).isDirectory()) {
    throw new GitHubError(`Local repository directory does not exist: ${root}`)
  }
  const [claudeMarketplace, copilotMarketplace] = await Promise.all([
    readJsonFileIfExists(path.join(root, '.claude-plugin', 'marketplace.json')),
    readJsonFileIfExists(path.join(root, '.github', 'plugin', 'marketplace.json'))
  ])
  return {
    root,
    claudePlugins: pluginSources(claudeMarketplace),
    copilotPlugins: pluginSources(copilotMarketplace)
  }
}

function annotateLocalRepoSkill(skill: RepoSkill, ctx: LocalRepoContext): RepoSkill {
  const evalPath = path.join(ctx.root, 'evals', skill.name, 'triggers.yaml')
  return {
    ...skill,
    marketplaces: {
      claude: ctx.claudePlugins.get(skill.name) === skill.repoPath,
      copilot: ctx.copilotPlugins.get(skill.name) === skill.repoPath
    },
    evals: {
      triggersPath: fsSync.existsSync(evalPath) ? path.relative(ctx.root, evalPath).split(path.sep).join('/') : null
    }
  }
}

async function readSkillDir(dir: string): Promise<SkillFile[]> {
  const out: SkillFile[] = []
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.DS_Store') continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        const buf = await fs.readFile(full)
        const rel = path.relative(dir, full).split(path.sep).join('/')
        if (buf.includes(0)) out.push({ path: rel, content: buf.toString('base64'), encoding: 'base64' })
        else out.push({ path: rel, content: buf.toString('utf8'), encoding: 'utf8' })
      }
    }
  }
  await walk(dir)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

async function listLocalRepoSkills(coords: { skillsPath: string; repoDir: string }): Promise<RepoSkill[]> {
  const bundled = await listBundledSkills()
  const ctx = await localRepoContext(coords.repoDir)
  const skillsRoot = path.join(ctx.root, coords.skillsPath || '')
  if (!fsSync.existsSync(skillsRoot) || !fsSync.statSync(skillsRoot).isDirectory()) {
    throw new GitHubError(`Skills path does not exist in local repo: ${skillsRoot}`)
  }
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  const skills: RepoSkill[] = [...bundled]
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMdPath = path.join(skillsRoot, entry.name, 'SKILL.md')
    if (!fsSync.existsSync(skillMdPath)) continue
    const content = await fs.readFile(skillMdPath, 'utf8')
    const repoPath = repoPathJoin(coords.skillsPath, entry.name)
    skills.push(annotateLocalRepoSkill({ ...parseSkillMd(content, entry.name), repoPath }, ctx))
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export async function doctorRepo(): Promise<RepoDoctorReport> {
  const coords = repoCoords()
  const localMode = !!coords.repoDir
  const skills = localMode
    ? (await listLocalRepoSkills(coords)).filter((s) => !isBundledSkillPath(s.repoPath))
    : (await listRepoSkills()).filter((s) => !isBundledSkillPath(s.repoPath))
  const report: RepoDoctorReport = {
    ok: true,
    mode: localMode ? 'local' : 'github',
    repo: `${coords.owner}/${coords.repo}`,
    branch: coords.branch,
    skillsPath: coords.skillsPath || '',
    repoDir: coords.repoDir || null,
    counts: {
      skills: skills.length,
      claudeMarketplace: 0,
      copilotMarketplace: 0,
      triggerEvals: 0,
      missingClaudeMarketplace: 0,
      missingCopilotMarketplace: 0,
      missingTriggerEvals: 0,
      sourceMismatches: 0,
      extraClaudePlugins: 0,
      extraCopilotPlugins: 0
    },
    skills: [],
    issues: []
  }

  if (!localMode) {
    report.issues.push({ severity: 'info', code: 'remote-doctor-limited', message: 'Marketplace and repo-level eval checks require local checkout mode.' })
    return report
  }

  const ctx = await localRepoContext(coords.repoDir)
  const skillNames = new Set(skills.map((s) => s.name))
  for (const skill of skills) {
    const expectedSource = `./${skill.repoPath}`
    const normalizedExpected = skill.repoPath
    const claudeSource = ctx.claudePlugins.get(skill.name) ?? null
    const copilotSource = ctx.copilotPlugins.get(skill.name) ?? null
    const evalPath = path.join(ctx.root, 'evals', skill.name, 'triggers.yaml')
    const triggersPath = fsSync.existsSync(evalPath) ? path.relative(ctx.root, evalPath).split(path.sep).join('/') : null
    const issues: string[] = []

    const claudeOk = claudeSource === expectedSource || claudeSource === normalizedExpected
    const copilotOk = copilotSource === expectedSource || copilotSource === normalizedExpected
    if (claudeOk) report.counts.claudeMarketplace++
    else if (!claudeSource) {
      report.counts.missingClaudeMarketplace++
      issues.push('missing-claude-marketplace')
    } else {
      report.counts.sourceMismatches++
      issues.push(`claude-source-mismatch:${claudeSource}`)
    }
    if (copilotOk) report.counts.copilotMarketplace++
    else if (!copilotSource) {
      report.counts.missingCopilotMarketplace++
      issues.push('missing-copilot-marketplace')
    } else {
      report.counts.sourceMismatches++
      issues.push(`copilot-source-mismatch:${copilotSource}`)
    }
    if (triggersPath) report.counts.triggerEvals++
    else {
      report.counts.missingTriggerEvals++
      issues.push('missing-trigger-evals')
    }

    report.skills.push({
      name: skill.name,
      repoPath: skill.repoPath,
      version: skill.version,
      marketplaces: { claude: claudeOk, copilot: copilotOk },
      marketplaceSources: { claude: claudeSource, copilot: copilotSource },
      evals: { triggersPath },
      issues
    })
  }

  for (const [name, source] of ctx.claudePlugins.entries()) {
    if (!skillNames.has(name)) {
      report.counts.extraClaudePlugins++
      report.issues.push({ severity: 'error', code: 'extra-claude-plugin', message: `Claude marketplace lists ${name}, but no matching skill exists.`, name, source })
    }
  }
  for (const [name, source] of ctx.copilotPlugins.entries()) {
    if (!skillNames.has(name)) {
      report.counts.extraCopilotPlugins++
      report.issues.push({ severity: 'error', code: 'extra-copilot-plugin', message: `Copilot marketplace lists ${name}, but no matching skill exists.`, name, source })
    }
  }
  for (const skill of report.skills) {
    for (const issue of skill.issues) {
      report.issues.push({ severity: 'error', code: issue.split(':')[0], message: `${skill.name}: ${issue}`, name: skill.name })
    }
  }
  report.ok = !report.issues.some((issue) => issue.severity === 'error')
  return report
}

/** List every bundled/default and repository skill. */
export async function listRepoSkills(): Promise<RepoSkill[]> {
  const bundled = await listBundledSkills()
  let octokit: Octokit
  let coords: { owner: string; repo: string; branch: string; skillsPath: string; repoDir: string }
  try {
    coords = repoCoords()
    if (coords.repoDir) return listLocalRepoSkills(coords)
    octokit = client()
  } catch (err) {
    if (bundled.length > 0) return bundled
    throw err
  }

  const { owner, repo, branch, skillsPath } = coords
  const skills: RepoSkill[] = [...bundled]

  try {
    const treeSha = await getTreeSha(octokit, owner, repo, branch)
    const { data } = await octokit.git.getTree({ owner, repo, tree_sha: treeSha, recursive: 'true' })

    const prefix = skillsPath ? skillsPath.replace(/\/$/, '') + '/' : ''

    for (const entry of data.tree) {
      if (entry.type !== 'blob' || !entry.path || !entry.sha) continue
      if (!entry.path.endsWith('SKILL.md')) continue
      if (prefix && !entry.path.startsWith(prefix)) continue

      const folder = entry.path.slice(0, -'/SKILL.md'.length) || entry.path.replace(/SKILL\.md$/, '')
      // Only treat top-level skill folders (a single segment under the prefix) as skills.
      const rel = prefix ? folder.slice(prefix.length) : folder
      if (rel.includes('/')) continue

      const blob = await octokit.git.getBlob({ owner, repo, file_sha: entry.sha })
      const content = Buffer.from(blob.data.content, 'base64').toString('utf8')
      const meta = parseSkillMd(content, rel || folder)
      skills.push({ ...meta, repoPath: folder })
    }
  } catch (err) {
    if (bundled.length > 0) return bundled
    throw err
  }

  skills.sort((a, b) => a.name.localeCompare(b.name))
  return skills
}

/** Download every file inside a skill folder from the repository or bundled defaults. */
export async function downloadSkill(repoPath: string): Promise<SkillFile[]> {
  if (isBundledSkillPath(repoPath)) return downloadBundledSkill(repoPath)

  const { owner, repo, branch, repoDir } = repoCoords()
  if (repoDir) {
    const ctx = await localRepoContext(repoDir)
    return readSkillDir(path.join(ctx.root, repoPath))
  }

  const octokit = client()
  const treeSha = await getTreeSha(octokit, owner, repo, branch)
  const { data } = await octokit.git.getTree({ owner, repo, tree_sha: treeSha, recursive: 'true' })

  const prefix = repoPath.replace(/\/$/, '') + '/'
  const files: SkillFile[] = []

  for (const entry of data.tree) {
    if (entry.type !== 'blob' || !entry.path || !entry.sha) continue
    if (!entry.path.startsWith(prefix)) continue
    const blob = await octokit.git.getBlob({ owner, repo, file_sha: entry.sha })
    const { content, encoding } = decodeBlob(blob.data.content)
    files.push({ path: entry.path.slice(prefix.length), content, encoding })
  }

  if (files.length === 0) {
    throw new GitHubError(`No files found for skill at "${repoPath}".`)
  }
  return files
}

/** Download a repo or bundled skill and parse it into a full bundle (for editing). */
export async function readRepoSkill(repoPath: string): Promise<SkillBundle> {
  if (isBundledSkillPath(repoPath)) return readBundledSkill(repoPath)

  const { repoDir } = repoCoords()
  const files = await downloadSkill(repoPath)
  const skillMd = files.find((f) => f.path === 'SKILL.md')
  const name = repoPath.split('/').pop() || 'skill'
  let meta: RepoSkill = { ...parseSkillMd(skillMd?.content ?? '', name), repoPath }
  if (repoDir) meta = annotateLocalRepoSkill(meta, await localRepoContext(repoDir))
  return { meta, files }
}

/**
 * Commit a skill onto a fresh branch and open a pull request.
 * Files are written under <skillsPath>/<name>/...
 */
export async function uploadSkillAsPR(
  name: string,
  files: SkillFile[],
  note?: string
): Promise<UploadResult> {
  const validation = validateSkillBundle(name, files)
  if (!validation.valid) {
    throw new GitHubError(`Skill validation failed: ${validation.errors.join(' ')}`)
  }

  const octokit = client()
  const { owner, repo, branch, skillsPath } = repoCoords()

  const baseBranch = await getBranch(octokit, owner, repo, branch)
  const baseCommitSha = baseBranch.commit.sha
  const baseTreeSha = baseBranch.commit.commit.tree.sha

  // Create a blob for every file so binary content is handled correctly.
  const treeEntries = await Promise.all(
    files.map(async (f) => {
      const blob = await octokit.git.createBlob({
        owner,
        repo,
        content: f.content,
        encoding: f.encoding === 'base64' ? 'base64' : 'utf-8'
      })
      return {
        path: repoPathJoin(skillsPath, name, f.path),
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.data.sha
      }
    })
  )

  const newTree = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: treeEntries
  })

  const commit = await octokit.git.createCommit({
    owner,
    repo,
    message: `Add/update skill: ${name}`,
    tree: newTree.data.sha,
    parents: [baseCommitSha]
  })

  const headBranch = `skill-ui/${name}-${Date.now()}`
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${headBranch}`,
    sha: commit.data.sha
  })

  const body = [
    `Submitted from **Skill UI**.`,
    '',
    `This pull request adds or updates the \`${name}\` skill.`,
    note ? `\n> ${note}` : ''
  ].join('\n')

  const pr = await octokit.pulls.create({
    owner,
    repo,
    base: branch,
    head: headBranch,
    title: `Add/update skill: ${name}`,
    body
  })

  return { prUrl: pr.data.html_url, prNumber: pr.data.number, branch: headBranch }
}
