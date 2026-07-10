#!/usr/bin/env node
/*
 * Agent-facing Skill UI CLI.
 *
 * This is intentionally dependency-light and self-contained so agents can rely on one
 * executable without knowing the GitHub repository URL or token plumbing. It reads the
 * same repository settings as the desktop app, then resolves auth from CLI config,
 * environment variables, an unencrypted desktop token fallback, or `gh auth token`.
 */

const fs = require('fs/promises')
const fsSync = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { createHash } = require('crypto')
const matter = require('gray-matter')

const VERSION = '0.1.0'
const APP_SETTINGS_PATH = path.join(os.homedir(), 'Library/Application Support/skill-ui/skill-ui-settings.json')
const CLI_CONFIG_PATH = process.env.SKILL_UI_CONFIG || path.join(os.homedir(), '.skill-ui', 'config.json')
const DEFAULT_SETTINGS = {
  repoOwner: '',
  repoName: 'skills',
  repoBranch: 'main',
  repoSkillsPath: '',
  repoDir: '',
  repoConfigPath: '',
  customSkillsDir: '',
  skillDefaults: {
    owner: '',
    lifecycle: 'experimental',
    mirrorLifecycle: 'review',
    version: '0.1.0',
    reviewIntervalDays: 180,
    channels: ['developer'],
  },
  configuredClients: [],
  repoConventions: {
    claudeMarketplacePath: '.claude-plugin/marketplace.json',
    copilotMarketplacePath: '.github/plugin/marketplace.json',
    skillsHubCatalogPath: 'skills.sh.json',
    evalsPath: 'evals',
    bundleExcludeNames: []
  }
}
const REPO_CONFIG_FILENAMES = ['skill-ui.config.json', '.skill-ui.json']
const BUNDLED_PREFIX = 'builtin/'
const BUNDLED_DIR = 'bundled-skills'
const IGNORED_SKILL_DIR_ENTRIES = new Set(['.git', 'node_modules', '.DS_Store'])
const IGNORED_PATH_PARTS = new Set(['.git', 'node_modules'])
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/
const RESERVED_WORDS = ['anthropic', 'claude']
const XML_TAG_RE = /<\/?[A-Za-z][^>]*>/
const LIFECYCLE_STATES = new Set(['experimental', 'review', 'active', 'maintain', 'deprecated', 'archived'])
const CHANNELS = new Set(['developer', 'runtime'])

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.exitCode = exitCode
  }
}

function usage() {
  return `Skill UI CLI ${VERSION}

One-stop-shop CLI for agents to list, read, install, scaffold, validate, mirror,
upload, and update full multi-file skill bundles from the configured Skill UI
repository.

Usage:
  skill-ui <command> [options]

Commands:
  list                         List bundled and repository skills
  read <skill>                 Print a bundled/repository skill bundle as JSON, including support files
  download <skill> [--target DIR]
                               Install a full skill bundle and write a receipt
  validate <skill-dir>         Validate SKILL.md plus all support files before upload
  scaffold <name> [--owner TEAM] [--lifecycle STATE] [--skill-version VERSION]
                               [--review-interval DAYS] [--channels LIST]
                               [--author NAME] [--license SPDX] [--source-type TYPE]
                               [--target DIR]
                               Create a governed skill template, printing JSON or writing to --target
  remote <github-url> [--name NAME] [--owner TEAM]
                               Import a GitHub skill as a mirror-ready JSON bundle
  mirror <github-url> [--name NAME] [--owner TEAM] [--dry-run]
                               Open a PR that mirrors a remote GitHub skill
  upload <skill-dir> [--note TEXT] [--dry-run]
                               Upload a new local skill folder as a GitHub pull request
  update <skill-dir> [--note TEXT] [--dry-run]
                               Upload changes for an existing skill as a GitHub pull request
  doctor                       Check repo skills, marketplace manifests, evals, and catalog entries
  config get                   Show resolved repo/client/default/convention config (token redacted)
  config set <key> <value>     Set CLI overrides: repoOwner, repoName, repoBranch,
                               repoSkillsPath, repoDir, repoConfigPath, customSkillsDir, token
  auth status                  Explain which authentication source will be used
  help                         Show this help

Common options:
  --json                       Emit machine-readable JSON where supported
  --repo owner/name            Override repository for one run
  --branch name                Override branch for one run
  --skills-path path           Override repository path containing skill folders
  --repo-dir DIR               Use a local checkout as the repository source for fast/offline scenarios
  --config FILE                Use a skill-ui.config.json/.skill-ui.json repository config file for this run
  --target DIR                 Target skills directory; omitted uses configured client/custom/Hermes fallback
  --note TEXT                  Pull request note/body addition
  --owner TEAM                 Internal owner for mirrored/new skills
  --lifecycle STATE            Lifecycle for mirrored/new skills (default: review for mirrors)
  --skill-version VERSION      Initial version for scaffolded skills
  --review-interval DAYS       Review interval for scaffolded skills
  --channels LIST              Comma-separated channels for scaffolded skills
  --author NAME                Author for scaffolded skills
  --license SPDX               License for scaffolded skills
  --source-type TYPE           metadata.organization.source_type for scaffolded skills
  --name NAME                  Destination name for mirrored remote skills
  --dry-run                    Validate and show intended action without writing to GitHub
  -h, --help                   Show help
  -v, --version                Show version

Configuration/auth resolution:
  1. CLI config: ${CLI_CONFIG_PATH}
  2. Environment: SKILL_UI_TOKEN, GITHUB_TOKEN, GH_TOKEN
  3. Skill UI desktop settings: ${APP_SETTINGS_PATH}
     (including encrypted tokens via Electron safeStorage)
  4. GitHub CLI: gh auth token

Examples:
  skill-ui list --json
  skill-ui download skill-ui-cli --target ~/.hermes/skills
  skill-ui download incident-summary --target ~/.hermes/skills
  skill-ui validate ./my-skill
  skill-ui config get --config /path/to/skill-ui.config.json --json
  skill-ui scaffold my-skill --owner @your-org/your-team --lifecycle experimental --skill-version 0.1.0 --review-interval 180 --channels developer --author "Skill Team" --license MIT --source-type internal --target ./skills --json
  skill-ui remote https://github.com/anthropics/skills/tree/main/skills/pdf --name anthropic-pdf --json
  skill-ui doctor --repo your-org/skills --skills-path skills --repo-dir /path/to/skills-checkout --json
  skill-ui mirror https://github.com/anthropics/skills/tree/main/skills/pdf --name anthropic-pdf --owner @your-org/your-team --dry-run --json
  skill-ui upload ./my-skill --note "Initial version"
  skill-ui update ./my-skill --dry-run --json
`
}

function parseArgs(argv) {
  const args = []
  const opts = { json: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--json') opts.json = true
    else if (token === '--dry-run') opts.dryRun = true
    else if (token === '-h' || token === '--help') opts.help = true
    else if (token === '-v' || token === '--version') opts.version = true
    else if (token === '--repo') opts.repo = requireValue(argv, ++i, '--repo')
    else if (token === '--branch') opts.branch = requireValue(argv, ++i, '--branch')
    else if (token === '--skills-path') opts.skillsPath = requireValue(argv, ++i, '--skills-path')
    else if (token === '--repo-dir') opts.repoDir = requireValue(argv, ++i, '--repo-dir')
    else if (token === '--config') opts.config = requireValue(argv, ++i, '--config')
    else if (token === '--target') opts.target = requireValue(argv, ++i, '--target')
    else if (token === '--note') opts.note = requireValue(argv, ++i, '--note')
    else if (token === '--owner') opts.owner = requireValue(argv, ++i, '--owner')
    else if (token === '--lifecycle') opts.lifecycle = requireValue(argv, ++i, '--lifecycle')
    else if (token === '--skill-version') opts.skillVersion = requireValue(argv, ++i, '--skill-version')
    else if (token === '--review-interval') opts.reviewInterval = requireValue(argv, ++i, '--review-interval')
    else if (token === '--channels') opts.channels = requireValue(argv, ++i, '--channels')
    else if (token === '--author') opts.author = requireValue(argv, ++i, '--author')
    else if (token === '--license') opts.license = requireValue(argv, ++i, '--license')
    else if (token === '--source-type') opts.sourceType = requireValue(argv, ++i, '--source-type')
    else if (token === '--name') opts.name = requireValue(argv, ++i, '--name')
    else if (token.startsWith('--repo=')) opts.repo = token.slice('--repo='.length)
    else if (token.startsWith('--branch=')) opts.branch = token.slice('--branch='.length)
    else if (token.startsWith('--skills-path=')) opts.skillsPath = token.slice('--skills-path='.length)
    else if (token.startsWith('--repo-dir=')) opts.repoDir = token.slice('--repo-dir='.length)
    else if (token.startsWith('--config=')) opts.config = token.slice('--config='.length)
    else if (token.startsWith('--target=')) opts.target = token.slice('--target='.length)
    else if (token.startsWith('--note=')) opts.note = token.slice('--note='.length)
    else if (token.startsWith('--owner=')) opts.owner = token.slice('--owner='.length)
    else if (token.startsWith('--lifecycle=')) opts.lifecycle = token.slice('--lifecycle='.length)
    else if (token.startsWith('--skill-version=')) opts.skillVersion = token.slice('--skill-version='.length)
    else if (token.startsWith('--review-interval=')) opts.reviewInterval = token.slice('--review-interval='.length)
    else if (token.startsWith('--channels=')) opts.channels = token.slice('--channels='.length)
    else if (token.startsWith('--author=')) opts.author = token.slice('--author='.length)
    else if (token.startsWith('--license=')) opts.license = token.slice('--license='.length)
    else if (token.startsWith('--source-type=')) opts.sourceType = token.slice('--source-type='.length)
    else if (token.startsWith('--name=')) opts.name = token.slice('--name='.length)
    else if (token.startsWith('-')) throw new CliError(`Unknown option: ${token}`, 2)
    else args.push(token)
  }
  return { args, opts }
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new CliError(`${flag} requires a value.`, 2)
  return value
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (err && err.code === 'ENOENT') return {}
    throw new CliError(`Could not read ${file}: ${err.message}`)
  }
}

async function loadConfig(opts = {}) {
  const app = await readJsonIfExists(APP_SETTINGS_PATH)
  const cli = await readJsonIfExists(CLI_CONFIG_PATH)
  const repoOverride = opts.repo ? parseRepo(opts.repo) : {}
  const preliminary = {
    ...DEFAULT_SETTINGS,
    ...pickSettings(app),
    ...pickSettings(cli),
    ...repoOverride,
    ...(opts.branch ? { repoBranch: opts.branch } : {}),
    ...(opts.skillsPath !== undefined ? { repoSkillsPath: opts.skillsPath } : {}),
    ...(opts.repoDir !== undefined ? { repoDir: opts.repoDir } : {}),
    ...(opts.config !== undefined ? { repoConfigPath: opts.config } : {})
  }
  const repoConfig = await readRepoConfig(preliminary)
  const configured = applyRepoConfig(preliminary, repoConfig)
  return {
    ...configured,
    ...repoOverride,
    ...(opts.branch ? { repoBranch: opts.branch } : {}),
    ...(opts.skillsPath !== undefined ? { repoSkillsPath: opts.skillsPath } : {}),
    ...(opts.repoDir !== undefined ? { repoDir: opts.repoDir } : {}),
    ...(opts.config !== undefined ? { repoConfigPath: path.resolve(expandHome(opts.config)) } : {})
  }
}

function pickSettings(input) {
  const out = {}
  for (const key of ['repoOwner', 'repoName', 'repoBranch', 'repoSkillsPath', 'repoDir', 'repoConfigPath', 'customSkillsDir', 'token', 'tokenEnc', 'tokenEncrypted']) {
    if (typeof input[key] === 'string' || typeof input[key] === 'boolean') out[key] = input[key]
  }
  return out
}

function normalizeRepoPath(value) {
  return String(value || '').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value) {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  return strings.length ? strings : undefined
}

async function readRepoConfig(cfg) {
  const candidates = []
  if (process.env.SKILL_UI_REPO_CONFIG) candidates.push(process.env.SKILL_UI_REPO_CONFIG)
  if (cfg.repoConfigPath) candidates.push(cfg.repoConfigPath)
  if (cfg.repoDir) {
    for (const name of REPO_CONFIG_FILENAMES) candidates.push(path.join(expandHome(cfg.repoDir), name))
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(expandHome(candidate))
    if (!fsSync.existsSync(resolved)) continue
    const raw = await readJsonIfExists(resolved)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CliError(`Repository config ${resolved} must contain a JSON object.`)
    return { path: resolved, raw }
  }
  return null
}

function applyRepoConfig(base, loaded) {
  if (!loaded) return base
  const raw = loaded.raw
  const repository = raw.repository && typeof raw.repository === 'object' ? raw.repository : {}
  const defaults = raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {}
  const conventions = raw.conventions && typeof raw.conventions === 'object' ? raw.conventions : {}
  const skillDefaults = {
    ...base.skillDefaults,
    ...(stringValue(defaults.owner) ? { owner: stringValue(defaults.owner) } : {}),
    ...(stringValue(defaults.lifecycle) ? { lifecycle: stringValue(defaults.lifecycle) } : {}),
    ...(stringValue(defaults.mirrorLifecycle) ? { mirrorLifecycle: stringValue(defaults.mirrorLifecycle) } : {}),
    ...(stringValue(defaults.version) ? { version: stringValue(defaults.version) } : {}),
    ...(Number.isInteger(defaults.reviewIntervalDays) && defaults.reviewIntervalDays > 0 ? { reviewIntervalDays: defaults.reviewIntervalDays } : {}),
    ...(stringArray(defaults.channels) ? { channels: stringArray(defaults.channels) } : {})
  }
  const repoConventions = {
    ...base.repoConventions,
    ...(stringValue(conventions.claudeMarketplacePath) ? { claudeMarketplacePath: normalizeRepoPath(conventions.claudeMarketplacePath) } : {}),
    ...(stringValue(conventions.copilotMarketplacePath) ? { copilotMarketplacePath: normalizeRepoPath(conventions.copilotMarketplacePath) } : {}),
    ...(stringValue(conventions.skillsHubCatalogPath) ? { skillsHubCatalogPath: normalizeRepoPath(conventions.skillsHubCatalogPath) } : {}),
    ...(stringValue(conventions.evalsPath) ? { evalsPath: normalizeRepoPath(conventions.evalsPath) } : {}),
    ...(stringArray(conventions.bundleExcludeNames) ? { bundleExcludeNames: stringArray(conventions.bundleExcludeNames) } : {})
  }
  const configuredClients = Array.isArray(raw.clients)
    ? raw.clients
        .filter((client) => client && typeof client === 'object' && stringValue(client.id) && stringValue(client.label) && stringValue(client.path))
        .map((client) => ({ id: stringValue(client.id), label: stringValue(client.label), path: expandHome(stringValue(client.path)), enabled: typeof client.enabled === 'boolean' ? client.enabled : true, custom: typeof client.custom === 'boolean' ? client.custom : stringValue(client.id) === 'custom' }))
    : []
  return {
    ...base,
    repoOwner: stringValue(repository.owner) || base.repoOwner,
    repoName: stringValue(repository.name) || base.repoName,
    repoBranch: stringValue(repository.branch) || base.repoBranch,
    repoSkillsPath: normalizeRepoPath(stringValue(repository.skillsPath) || base.repoSkillsPath),
    repoDir: expandHome(stringValue(repository.localCheckout) || base.repoDir || ''),
    repoConfigPath: loaded.path,
    skillDefaults,
    repoConventions,
    configuredClients
  }
}

function parseRepo(repo) {
  const cleaned = repo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
  const [repoOwner, repoName, extra] = cleaned.split('/')
  if (!repoOwner || !repoName || extra) throw new CliError(`Invalid --repo value "${repo}". Use owner/name.`, 2)
  return { repoOwner, repoName }
}

async function saveCliConfig(patch) {
  const current = await readJsonIfExists(CLI_CONFIG_PATH)
  const next = { ...current, ...patch }
  await fs.mkdir(path.dirname(CLI_CONFIG_PATH), { recursive: true })
  await fs.writeFile(CLI_CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  return next
}

async function resolveToken() {
  const cli = await readJsonIfExists(CLI_CONFIG_PATH)
  if (typeof cli.token === 'string' && cli.token.trim()) return { token: cli.token.trim(), source: 'CLI config token' }
  for (const name of ['SKILL_UI_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) {
    if (process.env[name]) return { token: process.env[name], source: `$${name}` }
  }

  const app = await readJsonIfExists(APP_SETTINGS_PATH)
  if (app.tokenEnc) {
    if (app.tokenEncrypted === false) {
      try {
        return { token: Buffer.from(app.tokenEnc, 'base64').toString('utf8'), source: 'Skill UI desktop settings token' }
      } catch {
        // Continue to encrypted token / gh fallback.
      }
    }

    const decrypted = decryptDesktopTokenWithElectron()
    if (decrypted.token) return decrypted
  }

  const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
  if (gh.status === 0 && gh.stdout.trim()) return { token: gh.stdout.trim(), source: 'gh auth token' }

  throw new CliError(
    'No GitHub token available. Run `gh auth login`, set SKILL_UI_TOKEN/GITHUB_TOKEN, open Skill UI and save a token, or `skill-ui config set token <token>`.'
  )
}

function decryptDesktopTokenWithElectron() {
  const helperPath = path.join(__dirname, 'decrypt-token-electron.cjs')
  if (!fsSync.existsSync(helperPath)) return { token: '', source: '' }

  let electronPath = ''
  try {
    electronPath = require('electron')
  } catch {
    return { token: '', source: '' }
  }

  if (typeof electronPath !== 'string' || !electronPath) return { token: '', source: '' }
  const res = spawnSync(electronPath, [helperPath, APP_SETTINGS_PATH], {
    encoding: 'utf8',
    env: process.env,
    timeout: 15000,
    windowsHide: true
  })
  const token = res.stdout.trim()
  if (res.status === 0 && token) return { token, source: 'Skill UI desktop encrypted token' }
  return { token: '', source: '' }
}

async function octokit() {
  const { Octokit } = await import('@octokit/rest')
  const { token } = await resolveToken()
  return new Octokit({
    auth: token,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
  })
}

async function octokitOptional() {
  const { Octokit } = await import('@octokit/rest')
  const resolved = await resolveToken().catch(() => ({ token: '' }))
  return new Octokit({
    ...(resolved.token ? { auth: resolved.token } : {}),
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
  })
}

function repoPathJoin(...parts) {
  return parts.filter((p) => p !== '').join('/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '')
}

async function getBranch(client, cfg) {
  try {
    const { data } = await client.repos.getBranch({ owner: cfg.repoOwner, repo: cfg.repoName, branch: cfg.repoBranch || 'main' })
    return data
  } catch (err) {
    if (err && err.status === 404) {
      throw new CliError(`Branch "${cfg.repoBranch || 'main'}" was not found in ${cfg.repoOwner}/${cfg.repoName}.`)
    }
    throw err
  }
}

function parseSkillMd(content, fallbackName) {
  let parsed = { data: {}, content }
  try {
    parsed = matter(content || '')
  } catch {
    parsed = { data: {}, content: content || '' }
  }
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {}
  const organization = data.metadata && typeof data.metadata === 'object' ? data.metadata.organization : undefined
  return {
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName,
    description: typeof data.description === 'string' ? data.description : '',
    version: typeof data.version === 'string' ? data.version : data.metadata && typeof data.metadata.version === 'string' ? data.metadata.version : organization && typeof organization.version === 'string' ? organization.version : null
  }
}

function slugify(input) {
  return String(input || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

function scaffoldSkillTemplate(rawName, opts = {}) {
  const name = slugify(rawName)
  if (!name) throw new CliError('Please provide a valid skill name.', 2)
  const title = name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const owner = opts.owner || 'TODO: set owning GitHub team'
  const lifecycle = opts.lifecycle || 'experimental'
  const version = opts.version || '0.1.0'
  const reviewIntervalDays = opts.reviewIntervalDays || 180
  const channels = opts.channels && opts.channels.length ? opts.channels : ['developer']
  const channelLines = channels.map((channel) => `      - ${channel}`).join('\n')
  const authorLine = opts.author ? `author: ${yamlScalar(opts.author)}\n` : ''
  const licenseLine = opts.license ? `license: ${yamlScalar(opts.license)}\n` : ''
  const sourceTypeLine = opts.sourceType ? `    source_type: ${yamlScalar(opts.sourceType)}\n` : ''
  const content = `---
name: ${name}
description: Describe what this skill does and, importantly, when the agent should use it.
${authorLine}${licenseLine}metadata:
  organization:
    owner: ${yamlScalar(owner)}
    lifecycle: ${lifecycle}
    version: ${yamlScalar(version)}
    review_interval_days: ${reviewIntervalDays}
${sourceTypeLine}    channels:
${channelLines}
    trigger_examples:
      - prompt: "Use this skill for <specific realistic task>."
        should_trigger: true
      - prompt: "Summarize a general document unrelated to this workflow."
        should_trigger: false
---

# ${title}

## Overview

Explain the purpose of this skill in a sentence or two.

## Instructions

1. Step one.
2. Step two.

## Examples

Provide a concrete example of using this skill.
`
  return { skill: { ...parseSkillMd(content, name), repoPath: `scaffold/${name}` }, files: [{ path: 'SKILL.md', content, encoding: 'utf8' }] }
}

function decodeBlob(base64) {
  const buf = Buffer.from(base64, 'base64')
  if (buf.includes(0)) return { content: base64, encoding: 'base64' }
  return { content: buf.toString('utf8'), encoding: 'utf8' }
}

async function getRepoTree(client, cfg) {
  const branch = await getBranch(client, cfg)
  const treeSha = branch.commit.commit.tree.sha
  const { data } = await client.git.getTree({ owner: cfg.repoOwner, repo: cfg.repoName, tree_sha: treeSha, recursive: 'true' })
  return data.tree
}

function bundledRoot() {
  return path.resolve(__dirname, '..', BUNDLED_DIR)
}

function isBundledPath(nameOrPath) {
  return nameOrPath.startsWith(BUNDLED_PREFIX)
}

function normalizeBundledName(nameOrPath) {
  return isBundledPath(nameOrPath) ? nameOrPath.slice(BUNDLED_PREFIX.length) : nameOrPath
}

async function listBundledSkills() {
  const root = bundledRoot()
  if (!fsSync.existsSync(root)) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const skills = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const skillMdPath = path.join(dir, 'SKILL.md')
    if (!fsSync.existsSync(skillMdPath)) continue
    const content = await fs.readFile(skillMdPath, 'utf8')
    skills.push({ ...parseSkillMd(content, entry.name), repoPath: `${BUNDLED_PREFIX}${entry.name}` })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

async function readBundledSkill(nameOrPath) {
  const name = normalizeBundledName(nameOrPath)
  const dir = path.join(bundledRoot(), name)
  if (!fsSync.existsSync(path.join(dir, 'SKILL.md'))) throw new CliError(`No bundled skill found for "${nameOrPath}".`)
  const files = await readSkillDir(dir)
  const skillMd = files.find((f) => f.path === 'SKILL.md')
  const meta = parseSkillMd(skillMd ? skillMd.content : '', name)
  return { skill: { ...meta, repoPath: `${BUNDLED_PREFIX}${name}` }, files }
}

function repoRootFromConfig(cfg) {
  if (!cfg.repoDir) return ''
  const root = path.resolve(expandHome(cfg.repoDir))
  if (!fsSync.existsSync(root) || !fsSync.statSync(root).isDirectory()) {
    throw new CliError(`Configured repoDir does not exist or is not a directory: ${root}`)
  }
  return root
}

async function readJsonFileIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw new CliError(`Could not read ${file}: ${err.message}`)
  }
}

function pluginSources(manifest) {
  const map = new Map()
  const plugins = manifest && Array.isArray(manifest.plugins) ? manifest.plugins : []
  for (const plugin of plugins) {
    if (plugin && typeof plugin.name === 'string') {
      map.set(plugin.name, typeof plugin.source === 'string' ? plugin.source.replace(/^\.\//, '') : '')
    }
  }
  return map
}

function skillsHubGroups(catalog) {
  const map = new Map()
  const groupings = catalog && Array.isArray(catalog.groupings) ? catalog.groupings : []
  for (const group of groupings) {
    const title = group && typeof group.title === 'string' ? group.title : 'Skills'
    const skills = group && Array.isArray(group.skills) ? group.skills : []
    for (const name of skills) if (typeof name === 'string') map.set(name, title)
  }
  return map
}

function treeHas(tree, filePath) {
  return tree.some((entry) => entry.type === 'blob' && entry.path === filePath)
}

async function readJsonBlobFromTree(client, cfg, tree, filePath) {
  const entry = tree.find((item) => item.type === 'blob' && item.path === filePath && item.sha)
  if (!entry || !entry.sha) return null
  const blob = await client.git.getBlob({ owner: cfg.repoOwner, repo: cfg.repoName, file_sha: entry.sha })
  return JSON.parse(Buffer.from(blob.data.content, 'base64').toString('utf8'))
}

async function remoteRepoContext(client, cfg, tree) {
  const [claudeMarketplace, copilotMarketplace, skillsHubCatalog] = await Promise.all([
    readJsonBlobFromTree(client, cfg, tree, cfg.repoConventions.claudeMarketplacePath),
    readJsonBlobFromTree(client, cfg, tree, cfg.repoConventions.copilotMarketplacePath),
    readJsonBlobFromTree(client, cfg, tree, cfg.repoConventions.skillsHubCatalogPath)
  ])
  return {
    claudePlugins: pluginSources(claudeMarketplace),
    copilotPlugins: pluginSources(copilotMarketplace),
    skillsHubGroups: skillsHubGroups(skillsHubCatalog)
  }
}

function annotateRemoteRepoSkill(skill, ctx, cfg, tree) {
  const evalPath = repoPathJoin(cfg.repoConventions.evalsPath, skill.name, 'triggers.yaml')
  return {
    ...skill,
    marketplaces: {
      claude: ctx.claudePlugins.get(skill.name) === skill.repoPath,
      copilot: ctx.copilotPlugins.get(skill.name) === skill.repoPath
    },
    evals: { triggersPath: treeHas(tree, evalPath) ? evalPath : null },
    skillsHub: { group: ctx.skillsHubGroups.get(skill.name) || null },
    install: { hermes: `${cfg.repoOwner}/${cfg.repoName}/${skill.repoPath}` }
  }
}

async function localRepoContext(cfg) {
  const root = repoRootFromConfig(cfg)
  const [claudeMarketplace, copilotMarketplace, skillsHubCatalog] = await Promise.all([
    readJsonFileIfExists(path.join(root, cfg.repoConventions.claudeMarketplacePath)),
    readJsonFileIfExists(path.join(root, cfg.repoConventions.copilotMarketplacePath)),
    readJsonFileIfExists(path.join(root, cfg.repoConventions.skillsHubCatalogPath))
  ])
  return {
    root,
    claudePlugins: pluginSources(claudeMarketplace),
    copilotPlugins: pluginSources(copilotMarketplace),
    skillsHubGroups: skillsHubGroups(skillsHubCatalog)
  }
}

function annotateLocalRepoSkill(skill, ctx, cfg) {
  const expectedSource = skill.repoPath
  const evalPath = path.join(ctx.root, cfg.repoConventions.evalsPath, skill.name, 'triggers.yaml')
  return {
    ...skill,
    marketplaces: {
      claude: ctx.claudePlugins.get(skill.name) === expectedSource,
      copilot: ctx.copilotPlugins.get(skill.name) === expectedSource
    },
    evals: {
      triggersPath: fsSync.existsSync(evalPath) ? path.relative(ctx.root, evalPath).split(path.sep).join('/') : null
    },
    skillsHub: { group: ctx.skillsHubGroups.get(skill.name) || null },
    install: { hermes: `${cfg.repoOwner}/${cfg.repoName}/${skill.repoPath}` }
  }
}

async function listLocalRepoSkills(cfg) {
  const bundled = await listBundledSkills()
  const ctx = await localRepoContext(cfg)
  const skillsRoot = path.join(ctx.root, cfg.repoSkillsPath || '')
  if (!fsSync.existsSync(skillsRoot) || !fsSync.statSync(skillsRoot).isDirectory()) {
    throw new CliError(`Skills path does not exist in local repo: ${skillsRoot}`)
  }
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  const skills = [...bundled]
  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_SKILL_DIR_ENTRIES.has(entry.name)) continue
    const skillMdPath = path.join(skillsRoot, entry.name, 'SKILL.md')
    if (!fsSync.existsSync(skillMdPath)) continue
    const content = await fs.readFile(skillMdPath, 'utf8')
    const repoPath = repoPathJoin(cfg.repoSkillsPath, entry.name)
    skills.push(annotateLocalRepoSkill({ ...parseSkillMd(content, entry.name), repoPath }, ctx, cfg))
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

async function readLocalRepoSkill(cfg, skill) {
  const ctx = await localRepoContext(cfg)
  const skillDir = path.join(ctx.root, skill.repoPath)
  const files = await readSkillDir(skillDir)
  return { skill: annotateLocalRepoSkill(skill, ctx, cfg), files }
}

async function doctorRepo(cfg) {
  const localMode = !!cfg.repoDir
  const skills = localMode ? (await listLocalRepoSkills(cfg)).filter((s) => !isBundledPath(s.repoPath)) : (await listRepoSkills(cfg)).filter((s) => !isBundledPath(s.repoPath))
  const report = {
    ok: true,
    mode: localMode ? 'local' : 'github',
    repo: `${cfg.repoOwner}/${cfg.repoName}`,
    branch: cfg.repoBranch || 'main',
    skillsPath: cfg.repoSkillsPath || '',
    repoDir: cfg.repoDir || null,
    counts: {
      skills: skills.length,
      claudeMarketplace: 0,
      copilotMarketplace: 0,
      triggerEvals: 0,
      skillsHub: 0,
      missingClaudeMarketplace: 0,
      missingCopilotMarketplace: 0,
      missingTriggerEvals: 0,
      missingSkillsHub: 0,
      sourceMismatches: 0,
      extraClaudePlugins: 0,
      extraCopilotPlugins: 0,
      extraSkillsHubEntries: 0
    },
    skills: [],
    issues: []
  }

  if (!localMode) {
    for (const skill of skills) {
      const claudeOk = skill.marketplaces?.claude === true
      const copilotOk = skill.marketplaces?.copilot === true
      const triggersPath = skill.evals?.triggersPath || null
      const skillsHubGroup = skill.skillsHub?.group || null
      const skillIssues = []
      if (claudeOk) report.counts.claudeMarketplace++
      else { report.counts.missingClaudeMarketplace++; skillIssues.push('missing-claude-marketplace') }
      if (copilotOk) report.counts.copilotMarketplace++
      else { report.counts.missingCopilotMarketplace++; skillIssues.push('missing-copilot-marketplace') }
      if (triggersPath) report.counts.triggerEvals++
      else { report.counts.missingTriggerEvals++; skillIssues.push('missing-trigger-evals') }
      if (skillsHubGroup) report.counts.skillsHub++
      else { report.counts.missingSkillsHub++; skillIssues.push('missing-skills-hub-grouping') }
      report.skills.push({
        name: skill.name,
        repoPath: skill.repoPath,
        version: skill.version,
        marketplaces: { claude: claudeOk, copilot: copilotOk },
        marketplaceSources: { claude: null, copilot: null },
        evals: { triggersPath },
        skillsHub: { group: skillsHubGroup },
        install: { hermes: skill.install?.hermes || `${cfg.repoOwner}/${cfg.repoName}/${skill.repoPath}` },
        issues: skillIssues
      })
    }
    for (const skill of report.skills) {
      for (const issue of skill.issues) report.issues.push({ severity: 'error', code: issue, message: `${skill.name}: ${issue}`, name: skill.name })
    }
    report.ok = !report.issues.some((issue) => issue.severity === 'error')
    return report
  }

  const ctx = await localRepoContext(cfg)
  const skillNames = new Set(skills.map((s) => s.name))
  for (const skill of skills) {
    const expectedSource = `./${skill.repoPath}`
    const normalizedExpected = skill.repoPath
    const claudeSource = ctx.claudePlugins.get(skill.name) || null
    const copilotSource = ctx.copilotPlugins.get(skill.name) || null
    const evalPath = path.join(ctx.root, cfg.repoConventions.evalsPath, skill.name, 'triggers.yaml')
    const triggersPath = fsSync.existsSync(evalPath) ? path.relative(ctx.root, evalPath).split(path.sep).join('/') : null
    const skillsHubGroup = ctx.skillsHubGroups.get(skill.name) || null
    const skillIssues = []

    if (claudeSource === expectedSource || claudeSource === normalizedExpected) report.counts.claudeMarketplace++
    else if (!claudeSource) {
      report.counts.missingClaudeMarketplace++
      skillIssues.push('missing-claude-marketplace')
    } else {
      report.counts.sourceMismatches++
      skillIssues.push(`claude-source-mismatch:${claudeSource}`)
    }

    if (copilotSource === expectedSource || copilotSource === normalizedExpected) report.counts.copilotMarketplace++
    else if (!copilotSource) {
      report.counts.missingCopilotMarketplace++
      skillIssues.push('missing-copilot-marketplace')
    } else {
      report.counts.sourceMismatches++
      skillIssues.push(`copilot-source-mismatch:${copilotSource}`)
    }

    if (triggersPath) report.counts.triggerEvals++
    else {
      report.counts.missingTriggerEvals++
      skillIssues.push('missing-trigger-evals')
    }
    if (skillsHubGroup) report.counts.skillsHub++
    else {
      report.counts.missingSkillsHub++
      skillIssues.push('missing-skills-hub-grouping')
    }

    report.skills.push({
      name: skill.name,
      repoPath: skill.repoPath,
      version: skill.version,
      marketplaces: { claude: claudeSource === expectedSource || claudeSource === normalizedExpected, copilot: copilotSource === expectedSource || copilotSource === normalizedExpected },
      marketplaceSources: { claude: claudeSource, copilot: copilotSource },
      evals: { triggersPath },
      skillsHub: { group: skillsHubGroup },
      install: { hermes: `${cfg.repoOwner}/${cfg.repoName}/${skill.repoPath}` },
      issues: skillIssues
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
  for (const [name, group] of ctx.skillsHubGroups.entries()) {
    if (!skillNames.has(name)) {
      report.counts.extraSkillsHubEntries++
      report.issues.push({ severity: 'error', code: 'extra-skills-hub-entry', message: `skills.sh.json lists ${name}, but no matching skill exists.`, name, source: group })
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

async function listRepoSkills(cfg) {
  if (cfg.repoDir) return listLocalRepoSkills(cfg)
  const bundled = await listBundledSkills()
  let client
  let tree
  try {
    client = await octokit()
    tree = await getRepoTree(client, cfg)
  } catch (err) {
    if (bundled.length) return bundled
    throw err
  }
  const prefix = cfg.repoSkillsPath ? cfg.repoSkillsPath.replace(/\/$/, '') + '/' : ''
  const ctx = await remoteRepoContext(client, cfg, tree)
  const skills = [...bundled]
  for (const entry of tree) {
    if (entry.type !== 'blob' || !entry.path || !entry.sha || !entry.path.endsWith('SKILL.md')) continue
    if (prefix && !entry.path.startsWith(prefix)) continue
    const folder = entry.path.slice(0, -'/SKILL.md'.length) || entry.path.replace(/SKILL\.md$/, '')
    const rel = prefix ? folder.slice(prefix.length) : folder
    if (!rel || rel.includes('/')) continue
    const blob = await client.git.getBlob({ owner: cfg.repoOwner, repo: cfg.repoName, file_sha: entry.sha })
    const content = Buffer.from(blob.data.content, 'base64').toString('utf8')
    skills.push(annotateRemoteRepoSkill({ ...parseSkillMd(content, rel), repoPath: folder }, ctx, cfg, tree))
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

async function findRepoSkill(cfg, nameOrPath) {
  const skills = await listRepoSkills(cfg)
  const skill = skills.find((s) => s.name === nameOrPath || s.repoPath === nameOrPath)
  if (!skill) throw new CliError(`Skill "${nameOrPath}" was not found in bundled defaults or ${cfg.repoOwner}/${cfg.repoName}.`)
  return skill
}

async function downloadSkill(cfg, nameOrPath) {
  const skill = await findRepoSkill(cfg, nameOrPath)
  if (isBundledPath(skill.repoPath)) return readBundledSkill(skill.repoPath)
  if (cfg.repoDir) return readLocalRepoSkill(cfg, skill)

  const client = await octokit()
  const tree = await getRepoTree(client, cfg)
  const prefix = skill.repoPath.replace(/\/$/, '') + '/'
  const files = []
  for (const entry of tree) {
    if (entry.type !== 'blob' || !entry.path || !entry.sha || !entry.path.startsWith(prefix)) continue
    const blob = await client.git.getBlob({ owner: cfg.repoOwner, repo: cfg.repoName, file_sha: entry.sha })
    const decoded = decodeBlob(blob.data.content)
    files.push({ path: entry.path.slice(prefix.length), ...decoded })
  }
  if (!files.length) throw new CliError(`No files found for skill at "${skill.repoPath}".`)
  return { skill, files }
}

function normalizeRemotePath(value) {
  return (value || '').replace(/^\/+|\/+$/g, '')
}

function yamlScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(String(value))
}

function parseGitHubRemoteUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    const shorthand = rawUrl.replace(/^github:/, '').replace(/^git@github\.com:/, '').replace(/\.git$/, '')
    const parts = shorthand.split('/').filter(Boolean)
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1], mode: 'repo', tail: parts.slice(2) }
    throw new CliError('Remote skill source must be a GitHub URL or owner/repo/path shorthand.', 2)
  }

  if (url.hostname !== 'github.com') throw new CliError('Only github.com remote skill sources are supported right now.', 2)
  const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/').filter(Boolean)
  const [owner, repo, marker, ...tail] = parts
  if (!owner || !repo) throw new CliError('GitHub URL must include owner and repository.', 2)
  if (marker === 'tree' || marker === 'blob') return { owner, repo, mode: marker, tail }
  if (!marker) return { owner, repo, mode: 'repo', tail: [] }
  return { owner, repo, mode: 'repo', tail: [marker, ...tail] }
}

async function resolveRemoteRefAndPath(client, owner, repo, mode, tail) {
  const defaultBranch = (await client.repos.get({ owner, repo })).data.default_branch
  if (mode === 'repo' && tail.length === 0) {
    const branch = await client.repos.getBranch({ owner, repo, branch: defaultBranch })
    return { ref: defaultBranch, path: '', commit: branch.data.commit.sha, treeSha: branch.data.commit.commit.tree.sha }
  }

  const candidates = mode === 'repo'
    ? [{ ref: defaultBranch, path: normalizeRemotePath(tail.join('/')) }]
    : tail.map((_, index) => ({ ref: tail.slice(0, index + 1).join('/'), path: normalizeRemotePath(tail.slice(index + 1).join('/')) }))

  for (const candidate of candidates) {
    try {
      const branch = await client.repos.getBranch({ owner, repo, branch: candidate.ref })
      const remotePath = mode === 'blob' && candidate.path.endsWith('/SKILL.md') ? candidate.path.slice(0, -'/SKILL.md'.length) : candidate.path
      return { ref: candidate.ref, path: remotePath, commit: branch.data.commit.sha, treeSha: branch.data.commit.commit.tree.sha }
    } catch (err) {
      if (!err || err.status !== 404) throw err
    }
  }
  throw new CliError(`Could not resolve a branch from ${tail.join('/') || defaultBranch}.`)
}

function upstreamLockYaml(info) {
  return [
    `name: ${yamlScalar(info.name)}`,
    `source: ${yamlScalar(info.source)}`,
    `path: ${yamlScalar(info.path)}`,
    `ref: ${yamlScalar(info.ref)}`,
    `commit: ${yamlScalar(info.commit)}`,
    `tree_sha: ${yamlScalar(info.treeSha)}`,
    `mirrored_at: ${yamlScalar(info.mirroredAt)}`,
    'local_revision: 1',
    'local_patches: false',
    ''
  ].join('\n')
}

function patchesMd(info) {
  return [
    '# Local patches',
    '',
    'This mirrored public skill currently has no local patches.',
    '',
    'If your organization changes this skill on top of upstream, document each patch here with why it exists, which files changed, and whether it should be proposed upstream.',
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

function annotateRemoteSkillMd(content, info, opts) {
  let parsed
  try {
    parsed = matter(content)
  } catch (err) {
    throw new CliError(`Remote SKILL.md frontmatter is not valid YAML: ${err.message}`)
  }
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {}
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? data.metadata : {}
  const organization = metadata.organization && typeof metadata.organization === 'object' && !Array.isArray(metadata.organization) ? metadata.organization : {}
  data.name = info.name
  metadata.organization = {
    ...organization,
    owner: opts.owner || organization.owner || 'TODO: set internal owner',
    lifecycle: opts.lifecycle || organization.lifecycle || 'review',
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
  return matter.stringify((parsed.content || '').trimStart(), data).trimEnd() + '\n'
}

async function importRemoteSkill(url, opts = {}) {
  const source = parseGitHubRemoteUrl(url)
  const client = await octokitOptional()
  const resolved = await resolveRemoteRefAndPath(client, source.owner, source.repo, source.mode, source.tail)
  const normalized = normalizeRemotePath(resolved.path)
  const prefix = normalized ? `${normalized}/` : ''
  const { data } = await client.git.getTree({ owner: source.owner, repo: source.repo, tree_sha: resolved.treeSha, recursive: 'true' })
  const skillMdEntry = data.tree.find((entry) => entry.type === 'blob' && entry.path === `${prefix}SKILL.md`)
  if (!skillMdEntry) throw new CliError(`No SKILL.md found at "${normalized || '.'}" in ${source.owner}/${source.repo}.`)

  const treeEntry = normalized ? data.tree.find((entry) => entry.type === 'tree' && entry.path === normalized) : { sha: resolved.treeSha }
  const files = []
  for (const entry of data.tree) {
    if (entry.type !== 'blob' || !entry.path || !entry.sha) continue
    if (prefix ? !entry.path.startsWith(prefix) : entry.path.includes('/')) continue
    const blob = await client.git.getBlob({ owner: source.owner, repo: source.repo, file_sha: entry.sha })
    files.push({ path: prefix ? entry.path.slice(prefix.length) : entry.path, ...decodeBlob(blob.data.content) })
  }

  const skillMd = files.find((file) => file.path === 'SKILL.md')
  if (!skillMd || skillMd.encoding !== 'utf8') throw new CliError('Remote skill must contain a UTF-8 SKILL.md file.')
  const initial = parseSkillMd(skillMd.content, normalized.split('/').pop() || source.repo)
  const name = (opts.name || initial.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const remote = {
    name,
    source: `https://github.com/${source.owner}/${source.repo}.git`,
    path: normalized || '.',
    ref: resolved.ref,
    commit: resolved.commit,
    treeSha: treeEntry && treeEntry.sha ? treeEntry.sha : resolved.treeSha,
    mirroredAt: new Date().toISOString().slice(0, 10)
  }
  const normalizedFiles = files.map((file) => file.path === 'SKILL.md' && file.encoding === 'utf8'
    ? { ...file, content: annotateRemoteSkillMd(file.content, remote, opts) }
    : file)
  if (!normalizedFiles.some((file) => file.path === 'upstream.lock.yaml')) normalizedFiles.push({ path: 'upstream.lock.yaml', content: upstreamLockYaml(remote), encoding: 'utf8' })
  if (!normalizedFiles.some((file) => file.path === 'PATCHES.md')) normalizedFiles.push({ path: 'PATCHES.md', content: patchesMd(remote), encoding: 'utf8' })
  const updatedSkillMd = normalizedFiles.find((file) => file.path === 'SKILL.md').content
  return { skill: { ...parseSkillMd(updatedSkillMd, name), repoPath: `remote/${name}` }, remote, files: normalizedFiles }
}

async function readSkillDir(dir) {
  const root = path.resolve(dir)
  const out = []
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (IGNORED_SKILL_DIR_ENTRIES.has(entry.name)) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        const buf = await fs.readFile(full)
        const rel = path.relative(root, full).split(path.sep).join('/')
        if (buf.includes(0)) out.push({ path: rel, content: buf.toString('base64'), encoding: 'base64' })
        else out.push({ path: rel, content: buf.toString('utf8'), encoding: 'utf8' })
      }
    }
  }
  await walk(root)
  return out
}

function filterBundleFiles(files) {
  const excluded = new Set(['.git', '.loop', 'node_modules', 'out', 'dist', 'evals', 'docs', 'schemas', '.github', '.claude-plugin', '.DS_Store', 'skills.lock.yaml', 'skills.sh.json'])
  return files
    .filter((file) => !file.path.split(/[\\/]/).some((part) => excluded.has(part)))
    .map((file) => ({ ...file, path: file.path.split(path.sep).join('/') }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

function hashSkillFiles(files) {
  const hash = createHash('sha256')
  for (const file of filterBundleFiles(files)) {
    hash.update(file.path, 'utf8')
    hash.update(Buffer.from([0]))
    hash.update(file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8'))
    hash.update(Buffer.from([0]))
  }
  return `sha256:${hash.digest('hex')}`
}

async function writeSkillBundle(targetDir, name, files) {
  const skillDir = path.join(expandHome(targetDir), name)
  try {
    const st = await fs.lstat(skillDir)
    if (st.isSymbolicLink()) throw new CliError(`Refusing to overwrite legacy symlink install: ${skillDir}`)
    await fs.rm(skillDir, { recursive: true, force: true })
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err
  }
  await fs.mkdir(skillDir, { recursive: true })
  for (const file of filterBundleFiles(files)) {
    const dest = path.join(skillDir, file.path)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    const data = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8')
    await fs.writeFile(dest, data)
  }
  return skillDir
}

function cliReceiptPath(client, skill) {
  const root = process.env.SKILL_UI_RECEIPTS_DIR || path.join(process.env.SKILL_UI_HOME || path.join(os.homedir(), '.skill-ui'), 'receipts')
  const safe = (value) => String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
  return path.join(root, safe(client), `${safe(skill)}.json`)
}

async function writeCliReceipt({ client, skill, cfg, repoPath, sourceBundleHash, installedDir, installedBundleHash }) {
  const now = new Date().toISOString()
  const receipt = {
    schemaVersion: 1,
    client,
    skill,
    sourceRepo: `${cfg.repoOwner}/${cfg.repoName}`,
    sourcePath: repoPath,
    sourceRef: cfg.repoBranch || '',
    sourceCommit: null,
    sourceBundleHash,
    installMethod: 'managed-copy',
    marketplaceName: null,
    installedPaths: [installedDir],
    installedBundleHash,
    installedAt: now,
    updatedAt: now
  }
  const dest = cliReceiptPath(client, skill)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
  return receipt
}

function expandHome(value) {
  if (!value) return value
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

function validateSkillBundle(name, files) {
  const errors = []
  const seen = new Set()
  if (!SKILL_NAME_RE.test(name)) errors.push('Skill folder name must be 1–64 characters and contain only lowercase letters, numbers, and hyphens.')
  if (RESERVED_WORDS.includes(name)) errors.push('Skill name cannot be a reserved word such as "anthropic" or "claude".')
  for (const file of files) validatePath(file, seen, errors)
  const skillMd = files.find((file) => file.path === 'SKILL.md')
  if (!skillMd) return { valid: false, errors: [...errors, 'A valid skill must contain a SKILL.md file at the skill folder root.'] }
  if (skillMd.encoding !== 'utf8') return { valid: false, errors: [...errors, 'SKILL.md must be a UTF-8 text file, not binary/base64.'] }

  let parsed
  try {
    parsed = matter(skillMd.content)
  } catch (err) {
    return { valid: false, errors: [...errors, `SKILL.md frontmatter is not valid YAML: ${err.message}`] }
  }
  if (!skillMd.content.trim().startsWith('---')) errors.push('SKILL.md must start with YAML frontmatter delimited by --- lines.')
  const data = parsed.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) errors.push('SKILL.md frontmatter must be a YAML object.')
  const frontmatterName = data && typeof data === 'object' ? data.name : undefined
  if (typeof frontmatterName !== 'string' || !frontmatterName.trim()) errors.push('SKILL.md frontmatter must include a non-empty name field.')
  else {
    const normalizedName = frontmatterName.trim()
    if (!SKILL_NAME_RE.test(normalizedName)) errors.push('SKILL.md name must be 1–64 characters and contain only lowercase letters, numbers, and hyphens.')
    if (RESERVED_WORDS.includes(normalizedName)) errors.push('SKILL.md name cannot be a reserved word such as "anthropic" or "claude".')
    if (XML_TAG_RE.test(normalizedName)) errors.push('SKILL.md name cannot contain XML/HTML tags.')
    if (normalizedName !== name) errors.push(`SKILL.md name "${normalizedName}" must match the skill folder name "${name}".`)
  }
  const description = data && typeof data === 'object' ? data.description : undefined
  if (typeof description !== 'string' || !description.trim()) errors.push('SKILL.md frontmatter must include a non-empty description field.')
  else {
    const trimmed = description.trim()
    if (trimmed.length > 1024) errors.push('SKILL.md description must be 1024 characters or fewer.')
    if (XML_TAG_RE.test(trimmed)) errors.push('SKILL.md description cannot contain XML/HTML tags.')
  }
  if (!parsed.content.trim()) errors.push('SKILL.md must include Markdown instructions after the frontmatter.')

  const metadata = data && typeof data === 'object' && data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? data.metadata : undefined
  const organization = metadata && metadata.organization && typeof metadata.organization === 'object' && !Array.isArray(metadata.organization) ? metadata.organization : undefined
  if (organization) {
    const lifecycle = organization.lifecycle
    if (typeof lifecycle !== 'string' || !LIFECYCLE_STATES.has(lifecycle)) errors.push(`metadata.organization.lifecycle must be one of: ${Array.from(LIFECYCLE_STATES).join(', ')}.`)
    const channels = organization.channels
    if (channels !== undefined && (!Array.isArray(channels) || channels.some((channel) => typeof channel !== 'string' || !CHANNELS.has(channel)))) errors.push('metadata.organization.channels may only contain developer and runtime.')
    if (lifecycle === 'active') {
      if (typeof organization.owner !== 'string' || !organization.owner.trim()) errors.push('Active skills must include metadata.organization.owner.')
      if (typeof organization.reviewed_at !== 'string' || !organization.reviewed_at.trim()) errors.push('Active skills must include metadata.organization.reviewed_at.')
      if (typeof organization.version !== 'string' && typeof metadata.version !== 'string') errors.push('Active internal skills must include metadata.organization.version or metadata.version.')
    }
    if (organization.source_type === 'mirrored-public') {
      const mirror = organization.mirror && typeof organization.mirror === 'object' && !Array.isArray(organization.mirror) ? organization.mirror : undefined
      const requiredMirrorFields = ['source', 'path', 'ref', 'mirrored_at']
      const hasCommitOrTree = mirror && (typeof mirror.commit === 'string' || typeof mirror.tree_sha === 'string')
      if (!mirror || requiredMirrorFields.some((field) => typeof mirror[field] !== 'string' || !String(mirror[field]).trim()) || !hasCommitOrTree) errors.push('Mirrored public skills must include metadata.organization.mirror source, path, ref, mirrored_at, and commit or tree_sha.')
      if (!files.some((file) => file.path === 'upstream.lock.yaml')) errors.push('Mirrored public skills must include upstream.lock.yaml.')
      if (!files.some((file) => file.path === 'PATCHES.md')) errors.push('Mirrored public skills must include PATCHES.md.')
    }
  }
  return { valid: errors.length === 0, errors }
}

function validatePath(file, seen, errors) {
  if (!file.path.trim()) return errors.push('Every file must have a non-empty relative path.')
  if (file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\')) {
    errors.push(`Invalid file path "${file.path}". Paths must be relative and use forward slashes.`)
  }
  if (file.path.split('/').some((part) => IGNORED_PATH_PARTS.has(part))) {
    errors.push(`Invalid file path "${file.path}". Do not include .git or node_modules inside a skill.`)
  }
  if (seen.has(file.path)) errors.push(`Duplicate file path "${file.path}".`)
  seen.add(file.path)
  if (file.encoding !== 'utf8' && file.encoding !== 'base64') errors.push(`Invalid encoding for "${file.path}".`)
}

async function uploadSkillAsPR(cfg, name, files, note) {
  const validation = validateSkillBundle(name, files)
  if (!validation.valid) throw new CliError(`Skill validation failed: ${validation.errors.join(' ')}`)

  const client = await octokit()
  const baseBranch = await getBranch(client, cfg)
  const baseCommitSha = baseBranch.commit.sha
  const baseTreeSha = baseBranch.commit.commit.tree.sha
  const treeEntries = []
  for (const file of files) {
    const blob = await client.git.createBlob({
      owner: cfg.repoOwner,
      repo: cfg.repoName,
      content: file.content,
      encoding: file.encoding === 'base64' ? 'base64' : 'utf-8'
    })
    treeEntries.push({ path: repoPathJoin(cfg.repoSkillsPath, name, file.path), mode: '100644', type: 'blob', sha: blob.data.sha })
  }

  const newTree = await client.git.createTree({
    owner: cfg.repoOwner,
    repo: cfg.repoName,
    base_tree: baseTreeSha,
    tree: treeEntries
  })
  const commit = await client.git.createCommit({
    owner: cfg.repoOwner,
    repo: cfg.repoName,
    message: `Add/update skill: ${name}`,
    tree: newTree.data.sha,
    parents: [baseCommitSha]
  })
  const headBranch = `skill-ui/${name}-${Date.now()}`
  await client.git.createRef({ owner: cfg.repoOwner, repo: cfg.repoName, ref: `refs/heads/${headBranch}`, sha: commit.data.sha })
  const body = [`Submitted from **Skill UI CLI**.`, '', `This pull request adds or updates the \`${name}\` skill.`, note ? `\n> ${note}` : ''].join('\n')
  const pr = await client.pulls.create({
    owner: cfg.repoOwner,
    repo: cfg.repoName,
    base: cfg.repoBranch,
    head: headBranch,
    title: `Add/update skill: ${name}`,
    body
  })
  return { prUrl: pr.data.html_url, prNumber: pr.data.number, branch: headBranch }
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

function printTable(rows) {
  if (!rows.length) return console.log('No skills found.')
  const widths = {
    name: Math.max('name'.length, ...rows.map((r) => r.name.length)),
    version: Math.max('version'.length, ...rows.map((r) => String(r.version || '').length)),
    repoPath: Math.max('repoPath'.length, ...rows.map((r) => r.repoPath.length))
  }
  console.log(`${'name'.padEnd(widths.name)}  ${'version'.padEnd(widths.version)}  ${'repoPath'.padEnd(widths.repoPath)}  description`)
  console.log(`${'-'.repeat(widths.name)}  ${'-'.repeat(widths.version)}  ${'-'.repeat(widths.repoPath)}  ${'-'.repeat(11)}`)
  for (const row of rows) {
    console.log(`${row.name.padEnd(widths.name)}  ${String(row.version || '').padEnd(widths.version)}  ${row.repoPath.padEnd(widths.repoPath)}  ${row.description || ''}`)
  }
}

async function main(argv) {
  const { args, opts } = parseArgs(argv)
  const command = args[0]
  if (!command || command === 'help' || opts.help) return console.log(usage())
  if (opts.version) return console.log(VERSION)

  if (command === 'config') {
    const sub = args[1]
    if (sub === 'get') {
      const cfg = await loadConfig(opts)
      const { source } = await resolveToken().catch((err) => ({ source: `unavailable: ${err.message}` }))
      const payload = { ...cfg, token: cfg.token ? '<redacted>' : undefined, tokenEnc: cfg.tokenEnc ? '<redacted>' : undefined, tokenSource: source }
      return opts.json ? printJson(payload) : console.log(JSON.stringify(payload, null, 2))
    }
    if (sub === 'set') {
      const key = args[2]
      const value = args[3]
      const allowed = new Set(['repoOwner', 'repoName', 'repoBranch', 'repoSkillsPath', 'repoDir', 'repoConfigPath', 'customSkillsDir', 'token'])
      if (!allowed.has(key) || value === undefined) throw new CliError('Usage: skill-ui config set <repoOwner|repoName|repoBranch|repoSkillsPath|repoDir|repoConfigPath|customSkillsDir|token> <value>', 2)
      await saveCliConfig({ [key]: value })
      return console.log(`Saved ${key} in ${CLI_CONFIG_PATH}${key === 'token' ? ' (redacted)' : `: ${value}`}`)
    }
    throw new CliError('Usage: skill-ui config get | config set <key> <value>', 2)
  }

  if (command === 'auth') {
    if (args[1] !== 'status') throw new CliError('Usage: skill-ui auth status', 2)
    const resolved = await resolveToken()
    return opts.json ? printJson({ authenticated: true, source: resolved.source }) : console.log(`Authenticated via ${resolved.source}.`)
  }

  const cfg = await loadConfig(opts)
  if (!cfg.repoOwner || !cfg.repoName) throw new CliError('Repository is not configured. Run `skill-ui config set repoOwner <owner>` and `skill-ui config set repoName <repo>`.')

  if (command === 'list') {
    const skills = await listRepoSkills(cfg)
    return opts.json ? printJson(skills) : printTable(skills)
  }

  if (command === 'doctor') {
    const report = await doctorRepo(cfg)
    if (opts.json) return printJson(report)
    console.log(`${report.ok ? 'OK' : 'ISSUES'} ${report.repo} (${report.mode})`)
    console.log(`skills=${report.counts.skills} claude=${report.counts.claudeMarketplace} copilot=${report.counts.copilotMarketplace} triggerEvals=${report.counts.triggerEvals}`)
    for (const issue of report.issues) console.log(`${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`)
    return
  }

  if (command === 'read') {
    const name = args[1]
    if (!name) throw new CliError('Usage: skill-ui read <skill>', 2)
    const bundle = await downloadSkill(cfg, name)
    return printJson(bundle)
  }

  if (command === 'download') {
    const name = args[1]
    if (!name) throw new CliError('Usage: skill-ui download <skill> [--target DIR]', 2)
    const { skill, files } = await downloadSkill(cfg, name)
    const configuredTarget = cfg.configuredClients.find((client) => client.enabled !== false)?.path
    const target = opts.target || configuredTarget || cfg.customSkillsDir || path.join(os.homedir(), '.hermes', 'skills')
    const installedDir = await writeSkillBundle(target, skill.name, files)
    const sourceBundleHash = hashSkillFiles(files)
    const installedBundleHash = hashSkillFiles(await readSkillDir(installedDir))
    if (installedBundleHash !== sourceBundleHash) throw new CliError(`Post-install verification failed: ${installedBundleHash} != ${sourceBundleHash}`)
    const client = target.includes('.claude') ? 'claude' : target.includes('.copilot') ? 'copilot' : target.includes('.hermes') ? 'hermes' : 'custom'
    const receipt = await writeCliReceipt({ client, skill: skill.name, cfg, repoPath: skill.repoPath, sourceBundleHash, installedDir, installedBundleHash })
    return opts.json ? printJson({ installedDir, skill, receipt }) : console.log(`Installed ${skill.name} to ${installedDir}`)
  }

  if (command === 'scaffold') {
    const name = args[1]
    if (!name) throw new CliError('Usage: skill-ui scaffold <name> [--owner TEAM] [--lifecycle STATE] [--skill-version VERSION] [--target DIR]', 2)
    const defaults = cfg.skillDefaults
    const bundle = scaffoldSkillTemplate(name, {
      owner: opts.owner || defaults.owner,
      lifecycle: opts.lifecycle || defaults.lifecycle,
      version: opts.skillVersion || defaults.version,
      reviewIntervalDays: opts.reviewInterval ? Number(opts.reviewInterval) : defaults.reviewIntervalDays,
      channels: opts.channels ? String(opts.channels).split(',').map((item) => item.trim()).filter(Boolean) : defaults.channels,
      author: opts.author,
      license: opts.license,
      sourceType: opts.sourceType
    })
    const validation = validateSkillBundle(bundle.skill.name, bundle.files)
    if (!validation.valid) throw new CliError(`Generated scaffold is invalid: ${validation.errors.join(' ')}`)
    if (opts.target) {
      const installedDir = await writeSkillBundle(opts.target, bundle.skill.name, bundle.files)
      return opts.json ? printJson({ installedDir, ...bundle }) : console.log(`Created ${bundle.skill.name} at ${installedDir}`)
    }
    return printJson(bundle)
  }

  if (command === 'remote' || command === 'mirror') {
    const url = args[1]
    if (!url) throw new CliError(`Usage: skill-ui ${command} <github-url> [--name NAME] [--owner TEAM]${command === 'mirror' ? ' [--dry-run]' : ''}`, 2)
    const bundle = await importRemoteSkill(url, { name: opts.name, owner: opts.owner || cfg.skillDefaults.owner, lifecycle: opts.lifecycle || cfg.skillDefaults.mirrorLifecycle })
    if (command === 'remote') return printJson(bundle)

    const validation = validateSkillBundle(bundle.skill.name, bundle.files)
    if (!validation.valid) throw new CliError(`Skill validation failed: ${validation.errors.join(' ')}`)
    const repoPath = repoPathJoin(cfg.repoSkillsPath, bundle.skill.name)
    if (opts.dryRun) {
      const payload = {
        valid: true,
        action: 'mirror',
        skill: bundle.skill.name,
        files: bundle.files.map((f) => f.path),
        remote: bundle.remote,
        repo: `${cfg.repoOwner}/${cfg.repoName}`,
        branch: cfg.repoBranch,
        repoPath
      }
      return opts.json ? printJson(payload) : console.log(`Dry run OK: would mirror ${bundle.skill.name} from ${bundle.remote.source}:${bundle.remote.path} to ${cfg.repoOwner}/${cfg.repoName}:${repoPath}`)
    }
    const note = opts.note || `Mirrors ${bundle.remote.source}:${bundle.remote.path} at ${bundle.remote.commit}.`
    const result = await uploadSkillAsPR(cfg, bundle.skill.name, bundle.files, note)
    return opts.json ? printJson({ ...result, remote: bundle.remote }) : console.log(`Opened mirror pull request: ${result.prUrl}\nBranch: ${result.branch}`)
  }

  if (command === 'validate' || command === 'upload' || command === 'update') {
    const dir = args[1]
    if (!dir) throw new CliError(`Usage: skill-ui ${command} <skill-dir>${command === 'validate' ? '' : ' [--note TEXT] [--dry-run]'}`, 2)
    const absDir = path.resolve(expandHome(dir))
    const files = await readSkillDir(absDir)
    const name = path.basename(absDir)
    const validation = validateSkillBundle(name, files)
    if (command === 'validate') {
      if (opts.json) return printJson(validation)
      if (validation.valid) return console.log(`Valid skill: ${name}`)
      throw new CliError(`Invalid skill: ${validation.errors.join(' ')}`)
    }
    if (!validation.valid) throw new CliError(`Skill validation failed: ${validation.errors.join(' ')}`)
    const repoPath = repoPathJoin(cfg.repoSkillsPath, name)
    if (opts.dryRun) {
      const payload = { valid: true, action: command, skill: name, files: files.map((f) => f.path), repo: `${cfg.repoOwner}/${cfg.repoName}`, branch: cfg.repoBranch, repoPath }
      return opts.json ? printJson(payload) : console.log(`Dry run OK: would ${command} ${files.length} files for ${name} to ${cfg.repoOwner}/${cfg.repoName}:${repoPath}`)
    }
    const result = await uploadSkillAsPR(cfg, name, files, opts.note)
    return opts.json ? printJson(result) : console.log(`Opened pull request: ${result.prUrl}\nBranch: ${result.branch}`)
  }

  throw new CliError(`Unknown command: ${command}\nRun: skill-ui --help`, 2)
}

main(process.argv.slice(2)).catch((err) => {
  if (err instanceof CliError) {
    console.error(`Error: ${err.message}`)
    process.exit(err.exitCode)
  }
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
