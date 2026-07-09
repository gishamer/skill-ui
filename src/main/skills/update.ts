import { basename } from 'path'
import type {
  LocalSkill,
  RepoSkill,
  UpdateArgs,
  UpdateReport,
  UpdateStatus
} from '@shared/types'
import { listLocalSkills, updateInstalledSkill } from './local'
import { listRepoSkills, downloadSkill } from '../github'
import { hashSkillFiles } from './bundle'
import { readReceipt } from './receipts'
import { classifyInstallState, nativeStateToLegacyUpdateState } from './status'

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
export async function computeStatus(local: LocalSkill, repo?: RepoSkill): Promise<UpdateStatus> {
  if (!repo) {
    return { state: 'not-in-repo', localVersion: local.version, repoVersion: null }
  }
  const sourceFiles = await downloadSkill(repo.repoPath)
  const sourceBundleHash = hashSkillFiles(sourceFiles)
  const receipt = local.receipt ?? (await readReceipt(local.clientId, local.name))
  const nativeState = classifyInstallState({
    installedDetected: true,
    installedInspectable: !!local.installedBundleHash,
    currentRepoHash: sourceBundleHash,
    installedHash: local.installedBundleHash ?? null,
    receipt,
    legacySymlink: local.nativeState === 'legacy-symlink'
  })
  return {
    state: nativeStateToLegacyUpdateState(nativeState),
    localVersion: local.version,
    repoVersion: repo.version,
    sourceBundleHash,
    installedBundleHash: local.installedBundleHash ?? null,
    receiptBundleHash: receipt?.sourceBundleHash ?? null
  }
}

function nativeStateFromUpdate(state: UpdateStatus['state']): LocalSkill['nativeState'] {
  if (state === 'up-to-date') return 'current'
  if (state === 'not-in-repo') return 'not-installed'
  if (state === 'unmanaged') return 'unmanaged-outdated'
  return state
}

/** Annotate local skills with their update status against the repository. */
export async function checkUpdates(): Promise<LocalSkill[]> {
  const [local, repo] = await Promise.all([listLocalSkills(), listRepoSkills()])
  const index = indexRepo(repo)
  const annotated: LocalSkill[] = []
  for (const skill of local) {
    const repoSkill = index.get(skill.name) ?? index.get(basename(skill.dir))
    const update = await computeStatus(skill, repoSkill)
    annotated.push({
      ...skill,
      update,
      nativeState: skill.nativeState ?? nativeStateFromUpdate(update.state)
    })
  }
  return annotated
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
  const safeToOverwrite = new Set(['outdated', 'not-in-repo'])

  for (const skill of candidates) {
    const repoSkill = index.get(skill.name) ?? index.get(basename(skill.dir))
    if (!repoSkill) {
      report.skipped.push({ name: skill.name, dir: skill.dir, reason: 'Not found in repository' })
      continue
    }
    const state = skill.update?.state ?? 'unknown'
    if (state === 'up-to-date') {
      report.skipped.push({ name: skill.name, dir: skill.dir, reason: 'Already up to date' })
      continue
    }
    if (!safeToOverwrite.has(state)) {
      report.skipped.push({
        name: skill.name,
        dir: skill.dir,
        reason: `Refusing to overwrite ${state} install without review/adopt action`
      })
      continue
    }
    try {
      await updateInstalledSkill(repoSkill.repoPath, skill.dir)
      report.updated.push({
        name: skill.name,
        dir: skill.dir,
        from: skill.update?.installedBundleHash ?? skill.update?.localVersion ?? null,
        to: skill.update?.sourceBundleHash ?? repoSkill.version
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
