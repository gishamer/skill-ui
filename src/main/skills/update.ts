import { dirname, basename } from 'path'
import type {
  LocalSkill,
  RepoSkill,
  UpdateArgs,
  UpdateReport,
  UpdateStatus
} from '@shared/types'
import { compareVersions } from './frontmatter'
import { listLocalSkills, writeSkillBundle } from './local'
import { listRepoSkills, downloadSkill } from '../github'

/** Build a lookup of repo skills keyed by both frontmatter name and folder name. */
function indexRepo(repo: RepoSkill[]): Map<string, RepoSkill> {
  const map = new Map<string, RepoSkill>()
  for (const r of repo) {
    map.set(r.name, r)
    map.set(basename(r.repoPath), r)
  }
  return map
}

/** Decide whether a local skill is outdated relative to its repo counterpart. */
export function computeStatus(local: LocalSkill, repo?: RepoSkill): UpdateStatus {
  if (!repo) {
    return { state: 'not-in-repo', localVersion: local.version, repoVersion: null }
  }
  let outdated: boolean
  if (local.version && repo.version) {
    outdated = compareVersions(repo.version, local.version) > 0
  } else {
    // No reliable versions on one side: fall back to content hash of SKILL.md.
    outdated = local.hash !== repo.hash
  }
  return {
    state: outdated ? 'outdated' : 'up-to-date',
    localVersion: local.version,
    repoVersion: repo.version
  }
}

/** Annotate local skills with their update status against the repository. */
export async function checkUpdates(): Promise<LocalSkill[]> {
  const [local, repo] = await Promise.all([listLocalSkills(), listRepoSkills()])
  const index = indexRepo(repo)
  return local.map((s) => ({ ...s, update: computeStatus(s, index.get(s.name) ?? index.get(basename(s.dir))) }))
}

/**
 * Update local skills from the repository.
 * When `targets` is provided, update those specific installations (if outdated);
 * otherwise update every outdated skill across all clients.
 */
export async function updateSkills(args: UpdateArgs): Promise<UpdateReport> {
  const annotated = await checkUpdates()
  const repo = await listRepoSkills()
  const index = indexRepo(repo)

  let candidates = annotated
  if (args.targets && args.targets.length > 0) {
    const wanted = new Set(args.targets.map((t) => t.dir))
    candidates = annotated.filter((s) => wanted.has(s.dir))
  }

  const report: UpdateReport = { updated: [], skipped: [] }

  for (const skill of candidates) {
    const repoSkill = index.get(skill.name) ?? index.get(basename(skill.dir))
    if (!repoSkill) {
      report.skipped.push({ name: skill.name, dir: skill.dir, reason: 'Not found in repository' })
      continue
    }
    if (skill.update?.state === 'up-to-date') {
      report.skipped.push({ name: skill.name, dir: skill.dir, reason: 'Already up to date' })
      continue
    }
    try {
      const files = await downloadSkill(repoSkill.repoPath)
      await writeSkillBundle(dirname(skill.dir), basename(skill.dir), files)
      report.updated.push({
        name: skill.name,
        dir: skill.dir,
        from: skill.update?.localVersion ?? null,
        to: repoSkill.version
      })
    } catch (err) {
      report.skipped.push({
        name: skill.name,
        dir: skill.dir,
        reason: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return report
}
