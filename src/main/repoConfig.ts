import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AppSettings, ClientConfig, RepoConventions, SkillDefaults } from '@shared/types'

export const REPO_CONFIG_FILENAMES = ['skill-ui.config.json', '.skill-ui.json']

interface RawRepoConfig {
  repository?: {
    owner?: unknown
    name?: unknown
    branch?: unknown
    skillsPath?: unknown
    localCheckout?: unknown
  }
  defaults?: {
    owner?: unknown
    lifecycle?: unknown
    mirrorLifecycle?: unknown
    version?: unknown
    reviewIntervalDays?: unknown
    channels?: unknown
  }
  clients?: unknown
  conventions?: {
    claudeMarketplacePath?: unknown
    copilotMarketplacePath?: unknown
    skillsHubCatalogPath?: unknown
    evalsPath?: unknown
    bundleExcludeNames?: unknown
  }
}

export interface LoadedRepoConfig {
  path: string
  raw: RawRepoConfig
}

const DEFAULT_SKILL_DEFAULTS: SkillDefaults = {
  owner: '',
  lifecycle: 'experimental',
  mirrorLifecycle: 'review',
  version: '0.1.0',
  reviewIntervalDays: 180,
  channels: ['developer']
}

const DEFAULT_CONVENTIONS: RepoConventions = {
  claudeMarketplacePath: '.claude-plugin/marketplace.json',
  copilotMarketplacePath: '.github/plugin/marketplace.json',
  skillsHubCatalogPath: 'skills.sh.json',
  evalsPath: 'evals',
  bundleExcludeNames: []
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  return strings.length > 0 ? strings : undefined
}

export function expandHome(input: string): string {
  if (input === '~') return os.homedir()
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2))
  return input
}

function normalizePathValue(input: string): string {
  return input.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

export function findRepoConfigPath(repoDir?: string, explicitPath?: string): string {
  const candidates: string[] = []
  if (process.env.SKILL_UI_REPO_CONFIG) candidates.push(process.env.SKILL_UI_REPO_CONFIG)
  if (explicitPath) candidates.push(explicitPath)
  if (repoDir) {
    for (const name of REPO_CONFIG_FILENAMES) candidates.push(path.join(repoDir, name))
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(expandHome(candidate))
    if (fs.existsSync(resolved)) return resolved
  }
  return explicitPath ? path.resolve(expandHome(explicitPath)) : ''
}

export function loadRepoConfig(repoDir?: string, explicitPath?: string): LoadedRepoConfig | null {
  const configPath = findRepoConfigPath(repoDir, explicitPath)
  if (!configPath || !fs.existsSync(configPath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RawRepoConfig
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('top-level value must be an object')
    }
    return { path: configPath, raw }
  } catch (err) {
    throw new Error(`Could not read repository config ${configPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function normalizeSkillDefaults(raw?: RawRepoConfig['defaults']): SkillDefaults {
  const channels = asStringArray(raw?.channels)
  return {
    owner: asString(raw?.owner) ?? DEFAULT_SKILL_DEFAULTS.owner,
    lifecycle: asString(raw?.lifecycle) ?? DEFAULT_SKILL_DEFAULTS.lifecycle,
    mirrorLifecycle: asString(raw?.mirrorLifecycle) ?? DEFAULT_SKILL_DEFAULTS.mirrorLifecycle,
    version: asString(raw?.version) ?? DEFAULT_SKILL_DEFAULTS.version,
    reviewIntervalDays: asPositiveInt(raw?.reviewIntervalDays) ?? DEFAULT_SKILL_DEFAULTS.reviewIntervalDays,
    channels: channels ?? DEFAULT_SKILL_DEFAULTS.channels
  }
}

export function normalizeRepoConventions(raw?: RawRepoConfig['conventions']): RepoConventions {
  return {
    claudeMarketplacePath: normalizePathValue(asString(raw?.claudeMarketplacePath) ?? DEFAULT_CONVENTIONS.claudeMarketplacePath),
    copilotMarketplacePath: normalizePathValue(asString(raw?.copilotMarketplacePath) ?? DEFAULT_CONVENTIONS.copilotMarketplacePath),
    skillsHubCatalogPath: normalizePathValue(asString(raw?.skillsHubCatalogPath) ?? DEFAULT_CONVENTIONS.skillsHubCatalogPath),
    evalsPath: normalizePathValue(asString(raw?.evalsPath) ?? DEFAULT_CONVENTIONS.evalsPath),
    bundleExcludeNames: asStringArray(raw?.bundleExcludeNames) ?? DEFAULT_CONVENTIONS.bundleExcludeNames
  }
}

export function normalizeClients(raw: unknown): ClientConfig[] {
  if (!Array.isArray(raw)) return []
  const clients: ClientConfig[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const id = asString(record.id)
    const label = asString(record.label) ?? id
    const targetPath = asString(record.path)
    if (!id || !label || !targetPath) continue
    clients.push({
      id,
      label,
      path: expandHome(targetPath),
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      custom: typeof record.custom === 'boolean' ? record.custom : id === 'custom'
    })
  }
  return clients
}

export function applyRepoConfig(base: AppSettings, loaded: LoadedRepoConfig | null): AppSettings {
  const raw = loaded?.raw
  const repository = raw?.repository
  const defaults = normalizeSkillDefaults(raw?.defaults)
  const repoDir = asString(repository?.localCheckout) ?? base.repoDir
  return {
    ...base,
    repoOwner: asString(repository?.owner) ?? base.repoOwner,
    repoName: asString(repository?.name) ?? base.repoName,
    repoBranch: asString(repository?.branch) ?? base.repoBranch,
    repoSkillsPath: normalizePathValue(asString(repository?.skillsPath) ?? base.repoSkillsPath),
    repoDir: repoDir ? expandHome(repoDir) : '',
    repoConfigPath: loaded?.path ?? base.repoConfigPath,
    skillDefaults: defaults,
    configuredClients: normalizeClients(raw?.clients),
    repoConventions: normalizeRepoConventions(raw?.conventions)
  }
}

export function defaultSkillDefaults(): SkillDefaults {
  return { ...DEFAULT_SKILL_DEFAULTS, channels: [...DEFAULT_SKILL_DEFAULTS.channels] }
}

export function defaultRepoConventions(): RepoConventions {
  return { ...DEFAULT_CONVENTIONS, bundleExcludeNames: [...DEFAULT_CONVENTIONS.bundleExcludeNames] }
}
