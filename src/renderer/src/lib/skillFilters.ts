import type { LocalSkill, RepoSkill } from '@shared/types'

export type SourceFilter = 'all' | 'remote' | 'own'
export type InstallFilter = 'all' | 'installed' | 'not-installed'

export interface CatalogFilters {
  owner: string
  source: SourceFilter
  install: InstallFilter
  updatableOnly: boolean
}

export interface SkillInstallSummary {
  installed: boolean
  updatable: boolean
}

export type SkillInstallMap = Record<string, SkillInstallSummary>

function folderName(repoPath: string): string {
  return repoPath.split('/').filter(Boolean).pop() ?? repoPath
}

function localMatchesRepo(local: LocalSkill, repo: RepoSkill): boolean {
  return (
    local.name === repo.name ||
    local.name === folderName(repo.repoPath) ||
    folderName(local.dir) === folderName(repo.repoPath) ||
    local.receipt?.sourcePath === repo.repoPath
  )
}

export function isRemoteSkill(skill: RepoSkill | LocalSkill): boolean {
  return Boolean(
    skill.remote ||
    skill.sourceType?.startsWith('mirrored') ||
    skill.sourceType === 'remote'
  )
}

export function buildInstallMap(repoSkills: RepoSkill[], localSkills: LocalSkill[]): SkillInstallMap {
  return Object.fromEntries(
    repoSkills.map((skill) => {
      const matches = localSkills.filter((local) => localMatchesRepo(local, skill))
      return [
        skill.repoPath,
        {
          installed: matches.length > 0,
          updatable: matches.some((local) => local.update?.state === 'outdated')
        }
      ]
    })
  )
}

export function ownerOptions(skills: RepoSkill[]): string[] {
  return Array.from(new Set(skills.map((skill) => skill.owner || '').filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

export function filterRepoSkills(
  skills: RepoSkill[],
  installMap: SkillInstallMap,
  filters: CatalogFilters
): RepoSkill[] {
  return skills.filter((skill) => {
    const install = installMap[skill.repoPath] ?? { installed: false, updatable: false }
    if (filters.owner && skill.owner !== filters.owner) return false
    if (filters.source === 'remote' && !isRemoteSkill(skill)) return false
    if (filters.source === 'own' && isRemoteSkill(skill)) return false
    if (filters.install === 'installed' && !install.installed) return false
    if (filters.install === 'not-installed' && install.installed) return false
    if (filters.updatableOnly && !install.updatable) return false
    return true
  })
}
