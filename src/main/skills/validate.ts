import matter from 'gray-matter'
import type { SkillFile } from '@shared/types'

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/
const XML_TAG_RE = /<\/?[A-Za-z][^>]*>/
const RESERVED_WORDS = ['anthropic', 'claude']
const IGNORED_PATH_PARTS = new Set(['.git', 'node_modules'])
const LIFECYCLE_STATES = new Set(['experimental', 'review', 'active', 'maintain', 'deprecated', 'archived'])
const CHANNELS = new Set(['developer', 'runtime'])

export interface SkillValidationResult {
  valid: boolean
  errors: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validatePath(file: SkillFile, seen: Set<string>, errors: string[]): void {
  if (!file.path.trim()) {
    errors.push('Every file must have a non-empty relative path.')
    return
  }

  if (file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\')) {
    errors.push(`Invalid file path "${file.path}". Paths must be relative and use forward slashes.`)
  }

  if (file.path.split('/').some((part) => IGNORED_PATH_PARTS.has(part))) {
    errors.push(`Invalid file path "${file.path}". Do not include .git or node_modules inside a skill.`)
  }

  if (seen.has(file.path)) {
    errors.push(`Duplicate file path "${file.path}".`)
  }
  seen.add(file.path)

  if (file.encoding !== 'utf8' && file.encoding !== 'base64') {
    errors.push(`Invalid encoding for "${file.path}".`)
  }
}

/** Validate a skill folder before install/upload using the public Agent Skills constraints. */
export function validateSkillBundle(name: string, files: SkillFile[]): SkillValidationResult {
  const errors: string[] = []
  const seen = new Set<string>()

  if (!SKILL_NAME_RE.test(name)) {
    errors.push('Skill folder name must be 1–64 characters and contain only lowercase letters, numbers, and hyphens.')
  }
  if (RESERVED_WORDS.includes(name)) {
    errors.push('Skill name cannot be a reserved word such as "anthropic" or "claude".')
  }

  for (const file of files) validatePath(file, seen, errors)

  const skillMd = files.find((file) => file.path === 'SKILL.md')
  if (!skillMd) {
    errors.push('A valid skill must contain a SKILL.md file at the skill folder root.')
    return { valid: false, errors }
  }

  if (skillMd.encoding !== 'utf8') {
    errors.push('SKILL.md must be a UTF-8 text file, not binary/base64.')
    return { valid: false, errors }
  }

  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(skillMd.content)
  } catch (err) {
    errors.push(`SKILL.md frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`)
    return { valid: false, errors }
  }

  if (!skillMd.content.trim().startsWith('---')) {
    errors.push('SKILL.md must start with YAML frontmatter delimited by --- lines.')
  }

  const data = parsed.data
  if (!isObject(data)) {
    errors.push('SKILL.md frontmatter must be a YAML object.')
  }

  const frontmatterName = isObject(data) ? data.name : undefined
  if (typeof frontmatterName !== 'string' || !frontmatterName.trim()) {
    errors.push('SKILL.md frontmatter must include a non-empty name field.')
  } else {
    const normalizedName = frontmatterName.trim()
    if (!SKILL_NAME_RE.test(normalizedName)) {
      errors.push('SKILL.md name must be 1–64 characters and contain only lowercase letters, numbers, and hyphens.')
    }
    if (RESERVED_WORDS.includes(normalizedName)) {
      errors.push('SKILL.md name cannot be a reserved word such as "anthropic" or "claude".')
    }
    if (XML_TAG_RE.test(normalizedName)) {
      errors.push('SKILL.md name cannot contain XML/HTML tags.')
    }
    if (normalizedName !== name) {
      errors.push(`SKILL.md name "${normalizedName}" must match the skill folder name "${name}".`)
    }
  }

  const description = isObject(data) ? data.description : undefined
  if (typeof description !== 'string' || !description.trim()) {
    errors.push('SKILL.md frontmatter must include a non-empty description field.')
  } else {
    const trimmed = description.trim()
    if (trimmed.length > 1024) {
      errors.push('SKILL.md description must be 1024 characters or fewer.')
    }
    if (XML_TAG_RE.test(trimmed)) {
      errors.push('SKILL.md description cannot contain XML/HTML tags.')
    }
  }

  if (!parsed.content.trim()) {
    errors.push('SKILL.md must include Markdown instructions after the frontmatter.')
  }

  if (isObject(data)) {
    const metadata = isObject(data.metadata) ? data.metadata : undefined
    const organization = metadata && isObject(metadata.organization) ? metadata.organization : undefined
    if (organization) {
      const lifecycle = organization.lifecycle
      if (typeof lifecycle !== 'string' || !LIFECYCLE_STATES.has(lifecycle)) {
        errors.push(`metadata.organization.lifecycle must be one of: ${Array.from(LIFECYCLE_STATES).join(', ')}.`)
      }

      const channels = organization.channels
      if (channels !== undefined) {
        if (!Array.isArray(channels) || channels.some((channel) => typeof channel !== 'string' || !CHANNELS.has(channel))) {
          errors.push('metadata.organization.channels may only contain developer and runtime.')
        }
      }

      if (lifecycle === 'active') {
        if (typeof organization.owner !== 'string' || !organization.owner.trim()) {
          errors.push('Active skills must include metadata.organization.owner.')
        }
        if (typeof organization.reviewed_at !== 'string' || !organization.reviewed_at.trim()) {
          errors.push('Active skills must include metadata.organization.reviewed_at.')
        }
        if (typeof organization.version !== 'string' && typeof (metadata as Record<string, unknown>).version !== 'string') {
          errors.push('Active internal skills must include metadata.organization.version or metadata.version.')
        }
      }

      if (organization.source_type === 'mirrored-public') {
        const mirror = isObject(organization.mirror) ? organization.mirror : undefined
        const requiredMirrorFields = ['source', 'path', 'ref', 'mirrored_at']
        const hasCommitOrTree = mirror && (typeof mirror.commit === 'string' || typeof mirror.tree_sha === 'string')
        if (!mirror || requiredMirrorFields.some((field) => typeof mirror[field] !== 'string' || !String(mirror[field]).trim()) || !hasCommitOrTree) {
          errors.push('Mirrored public skills must include metadata.organization.mirror source, path, ref, mirrored_at, and commit or tree_sha.')
        }
        if (!files.some((file) => file.path === 'upstream.lock.yaml')) {
          errors.push('Mirrored public skills must include upstream.lock.yaml.')
        }
        if (!files.some((file) => file.path === 'PATCHES.md')) {
          errors.push('Mirrored public skills must include PATCHES.md.')
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
