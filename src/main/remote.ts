import { Octokit } from '@octokit/rest'
import matter from 'gray-matter'
import type { RemoteSkillArgs, RemoteSkillInfo, SkillBundle, SkillFile } from '@shared/types'
import { getToken } from './settings'
import { parseSkillMd } from './skills/frontmatter'

class RemoteSkillError extends Error {}

const DEFAULT_LIFECYCLE = 'review'
const DEFAULT_OWNER = 'TODO: set internal owner'

function optionalClient(): Octokit {
  const token = getToken()
  return new Octokit({
    ...(token ? { auth: token } : {}),
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
  })
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && err.status === 404
}

function decodeBlob(base64: string): { content: string; encoding: 'utf8' | 'base64' } {
  const buf = Buffer.from(base64, 'base64')
  if (buf.includes(0)) return { content: base64, encoding: 'base64' }
  return { content: buf.toString('utf8'), encoding: 'utf8' }
}

function normalizePath(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

function yamlScalar(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function upstreamLockYaml(info: RemoteSkillInfo, localRevision = 1): string {
  return [
    `name: ${yamlScalar(info.name)}`,
    `source: ${yamlScalar(info.source)}`,
    `path: ${yamlScalar(info.path)}`,
    `ref: ${yamlScalar(info.ref)}`,
    `commit: ${yamlScalar(info.commit)}`,
    `tree_sha: ${yamlScalar(info.treeSha)}`,
    `mirrored_at: ${yamlScalar(info.mirroredAt)}`,
    `local_revision: ${localRevision}`,
    'local_patches: false',
    ''
  ].join('\n')
}

function patchesMd(info: RemoteSkillInfo): string {
  return [
    '# Local patches',
    '',
    'This mirrored public skill currently has no local patches.',
    '',
    'If your organization changes this skill on top of upstream, document each patch here with:',
    '',
    '- why the patch exists;',
    '- which files changed;',
    '- whether it should be proposed upstream or kept internal.',
    '',
    '## Upstream source',
    '',
    `- Source: ${info.source}`,
    `- Path: ${info.path}`,
    `- Ref: ${info.ref}`,
    `- Commit: ${info.commit}`,
    ''
  ].join('\n')
}

function annotateSkillMd(content: string, info: RemoteSkillInfo, owner?: string, lifecycle?: string): string {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(content)
  } catch (err) {
    throw new RemoteSkillError(`Remote SKILL.md frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`)
  }

  const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : {}) as Record<string, unknown>
  const metadata = (data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata
    : {}) as Record<string, unknown>
  const existingOrganization = (metadata.organization && typeof metadata.organization === 'object' && !Array.isArray(metadata.organization)
    ? metadata.organization
    : {}) as Record<string, unknown>

  data.name = info.name
  metadata.organization = {
    ...existingOrganization,
    owner: owner?.trim() || existingOrganization.owner || DEFAULT_OWNER,
    lifecycle: lifecycle?.trim() || existingOrganization.lifecycle || DEFAULT_LIFECYCLE,
    source_type: 'mirrored-public',
    mirror: {
      source: info.source,
      path: info.path,
      ref: info.ref,
      commit: info.commit,
      tree_sha: info.treeSha,
      mirrored_at: info.mirroredAt
    }
  }
  data.metadata = metadata

  return matter.stringify(parsed.content.trimStart(), data).trimEnd() + '\n'
}

function parseGitHubUrl(rawUrl: string): { owner: string; repo: string; mode: 'repo' | 'tree' | 'blob'; tail: string[] } {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    const shorthand = rawUrl.replace(/^github:/, '').replace(/^git@github\.com:/, '').replace(/\.git$/, '')
    const parts = shorthand.split('/').filter(Boolean)
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1], mode: 'repo', tail: parts.slice(2) }
    }
    throw new RemoteSkillError('Remote skill source must be a GitHub URL or owner/repo/path shorthand.')
  }

  if (url.hostname !== 'github.com') {
    throw new RemoteSkillError('Only github.com remote skill sources are supported right now.')
  }

  const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/').filter(Boolean)
  const [owner, repo, marker, ...tail] = parts
  if (!owner || !repo) throw new RemoteSkillError('GitHub URL must include owner and repository.')
  if (marker === 'tree' || marker === 'blob') return { owner, repo, mode: marker, tail }
  if (!marker) return { owner, repo, mode: 'repo', tail: [] }
  return { owner, repo, mode: 'repo', tail: [marker, ...tail] }
}

async function resolveRefAndPath(
  octokit: Octokit,
  owner: string,
  repo: string,
  mode: 'repo' | 'tree' | 'blob',
  tail: string[]
): Promise<{ ref: string; path: string; commit: string; treeSha: string }> {
  const defaultBranch = (await octokit.repos.get({ owner, repo })).data.default_branch

  if (mode === 'repo' && tail.length === 0) {
    const branch = await octokit.repos.getBranch({ owner, repo, branch: defaultBranch })
    return { ref: defaultBranch, path: '', commit: branch.data.commit.sha, treeSha: branch.data.commit.commit.tree.sha }
  }

  const candidates = mode === 'repo'
    ? [{ ref: defaultBranch, path: normalizePath(tail.join('/')) }]
    : tail.map((_, index) => ({ ref: tail.slice(0, index + 1).join('/'), path: normalizePath(tail.slice(index + 1).join('/')) }))

  for (const candidate of candidates) {
    if (!candidate.ref) continue
    try {
      const branch = await octokit.repos.getBranch({ owner, repo, branch: candidate.ref })
      return {
        ref: candidate.ref,
        path: mode === 'blob' && candidate.path.endsWith('/SKILL.md') ? candidate.path.slice(0, -'/SKILL.md'.length) : candidate.path,
        commit: branch.data.commit.sha,
        treeSha: branch.data.commit.commit.tree.sha
      }
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }

  for (const candidate of candidates) {
    if (!candidate.ref) continue
    try {
      const ref = await octokit.git.getRef({ owner, repo, ref: `tags/${candidate.ref}` })
      const commitSha = ref.data.object.sha
      const commit = await octokit.git.getCommit({ owner, repo, commit_sha: commitSha })
      return {
        ref: candidate.ref,
        path: mode === 'blob' && candidate.path.endsWith('/SKILL.md') ? candidate.path.slice(0, -'/SKILL.md'.length) : candidate.path,
        commit: commit.data.sha,
        treeSha: commit.data.tree.sha
      }
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }

  throw new RemoteSkillError(`Could not resolve a branch or tag from ${tail.join('/') || defaultBranch}.`)
}

async function fetchSkillFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  rootTreeSha: string,
  skillPath: string
): Promise<{ files: SkillFile[]; treeSha: string }> {
  const { data } = await octokit.git.getTree({ owner, repo, tree_sha: rootTreeSha, recursive: 'true' })
  const normalized = normalizePath(skillPath)
  const prefix = normalized ? `${normalized}/` : ''
  const skillMdPath = `${prefix}SKILL.md`
  const skillMd = data.tree.find((entry) => entry.type === 'blob' && entry.path === skillMdPath)
  if (!skillMd) throw new RemoteSkillError(`No SKILL.md found at "${normalized || '.'}" in ${owner}/${repo}.`)

  const files: SkillFile[] = []
  for (const entry of data.tree) {
    if (entry.type !== 'blob' || !entry.path || !entry.sha) continue
    if (prefix ? !entry.path.startsWith(prefix) : entry.path.includes('/')) continue
    const blob = await octokit.git.getBlob({ owner, repo, file_sha: entry.sha })
    const decoded = decodeBlob(blob.data.content)
    files.push({ path: prefix ? entry.path.slice(prefix.length) : entry.path, ...decoded })
  }

  const treeEntry = normalized
    ? data.tree.find((entry) => entry.type === 'tree' && entry.path === normalized)
    : { sha: rootTreeSha }
  return { files, treeSha: treeEntry?.sha || rootTreeSha }
}

/** Import a public or private GitHub-hosted skill as a governed mirror-ready bundle. */
export async function importRemoteSkill(args: RemoteSkillArgs): Promise<SkillBundle & { remote: RemoteSkillInfo }> {
  const source = args.url.trim()
  if (!source) throw new RemoteSkillError('Remote skill URL is required.')

  const parsed = parseGitHubUrl(source)
  const octokit = optionalClient()
  const resolved = await resolveRefAndPath(octokit, parsed.owner, parsed.repo, parsed.mode, parsed.tail)
  const { files, treeSha } = await fetchSkillFiles(octokit, parsed.owner, parsed.repo, resolved.treeSha, resolved.path)

  const skillMd = files.find((file) => file.path === 'SKILL.md')
  if (!skillMd || skillMd.encoding !== 'utf8') throw new RemoteSkillError('Remote skill must contain a UTF-8 SKILL.md file.')

  const initialMeta = parseSkillMd(skillMd.content, resolved.path.split('/').pop() || parsed.repo)
  const mirroredName = (args.name?.trim() || initialMeta.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const mirroredAt = new Date().toISOString().slice(0, 10)
  const remote: RemoteSkillInfo = {
    name: mirroredName,
    source: `https://github.com/${parsed.owner}/${parsed.repo}.git`,
    path: resolved.path || '.',
    ref: resolved.ref,
    commit: resolved.commit,
    treeSha,
    mirroredAt
  }

  const normalizedFiles = files.map((file) =>
    file.path === 'SKILL.md' && file.encoding === 'utf8'
      ? { ...file, content: annotateSkillMd(file.content, remote, args.owner, args.lifecycle) }
      : file
  )

  if (!normalizedFiles.some((file) => file.path === 'upstream.lock.yaml')) {
    normalizedFiles.push({ path: 'upstream.lock.yaml', content: upstreamLockYaml(remote), encoding: 'utf8' })
  }
  if (!normalizedFiles.some((file) => file.path === 'PATCHES.md')) {
    normalizedFiles.push({ path: 'PATCHES.md', content: patchesMd(remote), encoding: 'utf8' })
  }

  const updatedSkillMd = normalizedFiles.find((file) => file.path === 'SKILL.md')?.content ?? ''
  return { meta: parseSkillMd(updatedSkillMd, mirroredName), files: normalizedFiles, remote }
}
