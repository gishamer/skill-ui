/**
 * Shared types used across the main process, preload bridge and renderer.
 * Keep this file free of any Node or DOM specific imports.
 */

/** A known desktop client that hosts skills, plus the special "custom" entry. */
export interface ClientTarget {
  /** Stable id, e.g. "claude-desktop", "hermes" or "custom". */
  id: string
  /** Human friendly label shown in the UI. */
  label: string
  /** Absolute path to the directory where this client stores skills. */
  path: string
  /** Whether the directory currently exists on disk. */
  exists: boolean
  /** True for the user provided custom directory. */
  custom?: boolean
}

/** Parsed metadata for a single skill (from SKILL.md frontmatter). */
export interface SkillMeta {
  /** Folder / skill name (slug). */
  name: string
  /** Short description from frontmatter. */
  description: string
  /** Semantic version string if present (metadata.version), else null. */
  version: string | null
  /** Internal owning team/user from governed skill metadata. */
  owner?: string | null
  /** Governed source type, e.g. mirrored-public for remote mirrors. */
  sourceType?: string | null
  /** True when the skill is a mirrored remote/upstream skill. */
  remote?: boolean
  /** sha256 of the SKILL.md content, used as a fallback version signal. */
  hash: string
}

/** A skill as it exists in the remote skill repository. */
export interface RepoSkill extends SkillMeta {
  /** Path of the skill folder within the repository (e.g. "skills/pdf"). */
  repoPath: string
  /** Marketplace exposure annotations when available from a local/known repo shape. */
  marketplaces?: {
    claude?: boolean
    copilot?: boolean
  }
  /** Repository-level evaluation annotations when available. */
  evals?: {
    triggersPath: string | null
  }
  /** skills.sh catalog grouping annotation when available. */
  skillsHub?: {
    group: string | null
  }
  /** Ready-to-copy install identifiers for supported clients. */
  install?: {
    hermes: string
  }
}

export interface RepoDoctorIssue {
  severity: 'info' | 'error'
  code: string
  message: string
  name?: string
  source?: string
}

export interface RepoDoctorSkill {
  name: string
  repoPath: string
  version: string | null
  marketplaces: {
    claude: boolean
    copilot: boolean
  }
  marketplaceSources: {
    claude: string | null
    copilot: string | null
  }
  evals: {
    triggersPath: string | null
  }
  skillsHub: {
    group: string | null
  }
  install: {
    hermes: string
  }
  issues: string[]
}

export interface RepoDoctorReport {
  ok: boolean
  mode: 'local' | 'github'
  repo: string
  branch: string
  skillsPath: string
  repoDir: string | null
  counts: {
    skills: number
    claudeMarketplace: number
    copilotMarketplace: number
    triggerEvals: number
    skillsHub: number
    missingClaudeMarketplace: number
    missingCopilotMarketplace: number
    missingTriggerEvals: number
    missingSkillsHub: number
    sourceMismatches: number
    extraClaudePlugins: number
    extraCopilotPlugins: number
    extraSkillsHubEntries: number
  }
  skills: RepoDoctorSkill[]
  issues: RepoDoctorIssue[]
}

export type ClientId = 'hermes' | 'claude' | 'copilot' | 'npx-skills' | 'custom'

export type InstallMethod = 'native' | 'managed-copy'

export type NativeInstallState =
  | 'not-installed'
  | 'current'
  | 'outdated'
  | 'locally-modified'
  | 'diverged'
  | 'unmanaged-current'
  | 'unmanaged-outdated'
  | 'unmanaged-modified'
  | 'unknown'
  | 'blocked'
  | 'unsupported'
  | 'legacy-symlink'

export interface InstallReceipt {
  schemaVersion: 1
  client: ClientId | string
  skill: string
  sourceRepo: string
  sourcePath: string
  sourceRef: string
  sourceCommit: string | null
  sourceBundleHash: string
  installMethod: InstallMethod
  marketplaceName: string | null
  installedPaths: string[]
  installedBundleHash: string | null
  installedAt: string
  updatedAt: string
}

export interface ClientEnvironmentStatus {
  status: 'ok' | 'blocked' | 'unsupported'
  message?: string
}

export interface SourceSkillRef {
  name: string
  repoPath: string
  files: SkillFile[]
}

export interface InstalledBundleLocation {
  path: string
  inspectable: boolean
  legacySymlink?: boolean
}

export interface InstallResult {
  ok: boolean
  method: InstallMethod
  installedPath?: string
  installedBundleHash?: string | null
  output?: string
  error?: string
}

export interface ClientAdapter {
  id: ClientId
  displayName: string
  targetDir?: string
  installMethod: InstallMethod
  capabilities: {
    nativeInstall: boolean
    nativeUpdate: boolean
    inspectInstalledBundle: boolean
    listInstalledSkills: boolean
    importLocalChanges: boolean
  }
  detectEnvironment: () => Promise<ClientEnvironmentStatus>
  locateInstalledBundle: (skillName: string) => Promise<InstalledBundleLocation | null>
  install: (skill: SourceSkillRef) => Promise<InstallResult>
  update: (skill: SourceSkillRef) => Promise<InstallResult>
}

/** A skill installed into one of the local client directories. */
export interface LocalSkill extends SkillMeta {
  /** The client this installation belongs to. */
  clientId: string
  /** Absolute path to the installed skill folder. */
  dir: string
  /** Native synchronization state compared against repository, receipt, and installed bundle. */
  nativeState?: NativeInstallState
  /** Hash of the installed bundle when inspectable. */
  installedBundleHash?: string | null
  /** Last Skill UI receipt for this client/skill pair. */
  receipt?: InstallReceipt | null
  /** Update status compared against the repository, computed on demand. */
  update?: UpdateStatus
}

export type UpdateState =
  | 'up-to-date'
  | 'outdated'
  | 'not-in-repo'
  | 'unknown'
  | 'locally-modified'
  | 'diverged'
  | 'unmanaged'
  | 'blocked'
  | 'unsupported'
  | 'legacy-symlink'

export interface UpdateStatus {
  state: UpdateState
  localVersion: string | null
  repoVersion: string | null
  sourceBundleHash?: string | null
  installedBundleHash?: string | null
  receiptBundleHash?: string | null
}

/** A single file inside a skill folder (relative path + utf8/base64 content). */
export interface SkillFile {
  /** Path relative to the skill folder, e.g. "SKILL.md" or "scripts/run.py". */
  path: string
  /** File content. Text files are utf8; binaries are base64 (see `encoding`). */
  content: string
  encoding: 'utf8' | 'base64'
}

/** Full skill payload: metadata + every file in the folder. */
export interface SkillBundle {
  meta: SkillMeta
  files: SkillFile[]
}

export type SkillLifecycle = 'experimental' | 'review' | 'active' | 'maintain' | 'deprecated' | 'archived'

/** Provenance for a skill imported from a remote public/private repository. */
export interface RemoteSkillInfo {
  /** Destination skill folder/name after optional mirror renaming. */
  name: string
  /** Upstream git source, e.g. https://github.com/anthropics/skills.git. */
  source: string
  /** Upstream skill folder path. */
  path: string
  /** Upstream branch or tag. */
  ref: string
  /** Resolved upstream commit. */
  commit: string
  /** Tree sha for the upstream skill folder. */
  treeSha: string
  /** ISO date when the mirror bundle was produced. */
  mirroredAt: string
}

/** Arguments for importing/mirroring a remote GitHub skill. */
export interface RemoteSkillArgs {
  /** GitHub repo/tree/blob URL or owner/repo/path shorthand. */
  url: string
  /** Optional internal owner written to metadata.organization.owner. */
  owner?: string
  /** Lifecycle state to write to metadata.organization.lifecycle; defaults to review. */
  lifecycle?: SkillLifecycle | string
  /** Optional destination name for the mirrored skill. */
  name?: string
}

export type RemoteSkillBundle = SkillBundle & { remote: RemoteSkillInfo }

export interface ScaffoldSkillArgs {
  name: string
  owner?: string
  lifecycle?: SkillLifecycle | string
  version?: string
  reviewIntervalDays?: number
  channels?: string[]
  author?: string
  license?: string
  sourceType?: string
}

export interface ClientConfig {
  /** Stable id, e.g. "hermes", "claude", "copilot", "npx-skills" or an org-specific id. */
  id: string
  /** Human friendly label shown in the UI. */
  label: string
  /** Absolute or home-relative path to this client's skills directory. */
  path: string
  /** Whether this configured client target should be shown/used. */
  enabled: boolean
  /** True for arbitrary local-folder targets. */
  custom?: boolean
}

export interface SkillDefaults {
  /** Default team/owner metadata for newly created or mirrored skills. */
  owner: string
  /** Default lifecycle for newly authored internal skills. */
  lifecycle: SkillLifecycle | string
  /** Default lifecycle for mirrored remote skills. */
  mirrorLifecycle: SkillLifecycle | string
  /** Initial version written to new skill metadata. */
  version: string
  /** Default metadata review interval in days. */
  reviewIntervalDays: number
  /** Default publishing/consumer channels. */
  channels: string[]
}

export interface RepoConventions {
  /** Path to the Claude marketplace manifest in the configured repository. */
  claudeMarketplacePath: string
  /** Path to the Copilot/VS Code marketplace manifest in the configured repository. */
  copilotMarketplacePath: string
  /** Path to the skills.sh catalog file in the configured repository. */
  skillsHubCatalogPath: string
  /** Repository path containing trigger eval folders by skill name. */
  evalsPath: string
  /** Extra top-level/path-part names excluded from installed bundles. */
  bundleExcludeNames: string[]
}

/** Persisted application settings plus resolved repository JSON configuration. */
export interface AppSettings {
  /** GitHub repo owner that hosts the org skill repository. */
  repoOwner: string
  /** GitHub repo name. */
  repoName: string
  /** Branch to read skills from / open PRs against. */
  repoBranch: string
  /** Sub path within the repo that contains skill folders ("" = repo root). */
  repoSkillsPath: string
  /** Optional local checkout used as the repository source for fast/offline browsing. */
  repoDir: string
  /** Optional local JSON config file for this skill repository. */
  repoConfigPath: string
  /** Whether a GitHub token is currently stored (the token itself is never returned). */
  hasToken: boolean
  /** User provided custom skills directory (optional). */
  customSkillsDir: string
  /** Defaults used for new/mirrored skills. */
  skillDefaults: SkillDefaults
  /** Client install targets configured by the repository JSON file. */
  configuredClients: ClientConfig[]
  /** Repository layout conventions configured by the repository JSON file. */
  repoConventions: RepoConventions
}

/** Result of opening a pull request for an uploaded skill. */
export interface UploadResult {
  prUrl: string
  prNumber: number
  branch: string
}

/** Validation result for a skill folder before install/upload. */
export interface SkillValidationResult {
  valid: boolean
  errors: string[]
}

/** A generic IPC result wrapper so the renderer can show friendly errors. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Arguments for installing a repo skill into local client directories. */
export interface InstallArgs {
  repoPath: string
  /** Target client directories (absolute paths). */
  targetDirs: string[]
}

/** Arguments for saving / installing a locally authored skill. */
export interface SaveLocalArgs {
  name: string
  files: SkillFile[]
  targetDirs: string[]
}

/** Arguments for uploading a skill to the repository as a PR. */
export interface UploadArgs {
  name: string
  files: SkillFile[]
  /** Optional human note added to the PR body. */
  note?: string
}

/** Arguments for updating local skills from the repository. */
export interface UpdateArgs {
  /** Specific local skills to update; when omitted, update all outdated. */
  targets?: { clientId: string; dir: string }[]
}

export interface UpdateReport {
  updated: { name: string; dir: string; from: string | null; to: string | null }[]
  skipped: { name: string; dir: string; reason: string }[]
}

export interface InstalledDiffArgs {
  repoPath: string
  dir: string
}

export interface InstalledDiffResult {
  text: string
  added: string[]
  removed: string[]
  changed: string[]
}

export interface AdoptLocalArgs extends InstalledDiffArgs {}

export interface AdoptLocalResult {
  adoptedPath: string
  files: string[]
}

/** The full API surface exposed to the renderer via the preload bridge. */
export interface SkillUiApi {
  settings: {
    get: () => Promise<AppSettings>
    set: (patch: Partial<AppSettings> & { token?: string }) => Promise<AppSettings>
    testConnection: () => Promise<IpcResult<{ login: string }>>
  }
  clients: {
    detect: () => Promise<ClientTarget[]>
    pickDirectory: () => Promise<string | null>
  }
  repo: {
    list: () => Promise<IpcResult<RepoSkill[]>>
    read: (repoPath: string) => Promise<IpcResult<SkillBundle>>
    doctor: () => Promise<IpcResult<RepoDoctorReport>>
  }
  remote: {
    import: (args: RemoteSkillArgs) => Promise<IpcResult<RemoteSkillBundle>>
  }
  local: {
    list: () => Promise<IpcResult<LocalSkill[]>>
    checkUpdates: () => Promise<IpcResult<LocalSkill[]>>
    read: (dir: string) => Promise<IpcResult<SkillBundle>>
    openDir: (dir: string) => Promise<void>
  }
  skills: {
    install: (args: InstallArgs) => Promise<IpcResult<{ installed: string[] }>>
    scaffold: (args: string | ScaffoldSkillArgs) => Promise<IpcResult<SkillBundle>>
    validate: (args: { name: string; files: SkillFile[] }) => Promise<IpcResult<SkillValidationResult>>
    saveLocal: (args: SaveLocalArgs) => Promise<IpcResult<{ installed: string[] }>>
    upload: (args: UploadArgs) => Promise<IpcResult<UploadResult>>
    update: (args: UpdateArgs) => Promise<IpcResult<UpdateReport>>
    diffInstalled: (args: InstalledDiffArgs) => Promise<IpcResult<InstalledDiffResult>>
    adoptLocal: (args: AdoptLocalArgs) => Promise<IpcResult<AdoptLocalResult>>
  }
}
