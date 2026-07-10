import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import matter from 'gray-matter'
import type { ScaffoldSkillArgs, SkillBundle } from '@shared/types'
import { getSettings } from '../settings'
import { parseSkillMd } from './frontmatter'

const execFileAsync = promisify(execFile)

/** Normalise a free-form name into a valid skill slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function template(name: string, opts: Partial<ScaffoldSkillArgs> = {}): string {
  const title = name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const owner = opts.owner?.trim() || 'TODO: set owning GitHub team'
  const lifecycle = opts.lifecycle?.toString().trim() || 'experimental'
  const version = opts.version?.trim() || '0.1.0'
  const reviewIntervalDays = opts.reviewIntervalDays || 180
  const channels = opts.channels && opts.channels.length > 0 ? opts.channels : ['developer']
  const channelLines = channels.map((channel) => `      - ${channel}`).join('\n')
  const authorLine = opts.author?.trim() ? `author: ${yamlString(opts.author.trim())}\n` : ''
  const licenseLine = opts.license?.trim() ? `license: ${yamlString(opts.license.trim())}\n` : ''
  const sourceTypeLine = opts.sourceType?.trim() ? `    source_type: ${yamlString(opts.sourceType.trim())}\n` : ''
  return `---
name: ${name}
description: Describe what this skill does and, importantly, when the agent should use it.
${authorLine}${licenseLine}metadata:
  organization:
    owner: ${yamlString(owner)}
    lifecycle: ${lifecycle}
    version: ${yamlString(version)}
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
}

function withLifecycleMetadata(content: string, opts: Partial<ScaffoldSkillArgs>): string {
  const hasMetadata = Boolean(
    opts.owner?.trim() ||
    opts.lifecycle?.toString().trim() ||
    opts.version?.trim() ||
    opts.reviewIntervalDays ||
    opts.channels?.length ||
    opts.author?.trim() ||
    opts.license?.trim() ||
    opts.sourceType?.trim()
  )
  if (!hasMetadata) return content
  const parsed = matter(content)
  const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : {}) as Record<string, unknown>
  const metadata = (data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata
    : {}) as Record<string, unknown>
  const organization = (metadata.organization && typeof metadata.organization === 'object' && !Array.isArray(metadata.organization)
    ? metadata.organization
    : {}) as Record<string, unknown>
  if (opts.author?.trim()) data.author = opts.author.trim()
  if (opts.license?.trim()) data.license = opts.license.trim()
  metadata.organization = {
    ...organization,
    owner: opts.owner?.trim() || organization.owner || 'TODO: set owning GitHub team',
    lifecycle: opts.lifecycle?.toString().trim() || organization.lifecycle || 'experimental',
    version: opts.version?.trim() || organization.version || metadata.version || '0.1.0',
    review_interval_days: opts.reviewIntervalDays || organization.review_interval_days || 180,
    ...(opts.sourceType?.trim() ? { source_type: opts.sourceType.trim() } : {}),
    channels: opts.channels && opts.channels.length > 0 ? opts.channels : organization.channels || ['developer']
  }
  data.metadata = metadata
  return matter.stringify(parsed.content.trimStart(), data).trimEnd() + '\n'
}

/**
 * Scaffold a new skill.
 *
 * Tries the canonical \`npx skills init\` workflow first (so the output matches the
 * wider npx-skills ecosystem). Falls back to an equivalent built-in SKILL.md
 * template when npm / npx is unavailable or offline, so creation always works.
 */
export async function scaffoldSkill(
  rawNameOrArgs: string | ScaffoldSkillArgs
): Promise<SkillBundle> {
  const rawName = typeof rawNameOrArgs === 'string' ? rawNameOrArgs : rawNameOrArgs.name
  const requested: Partial<ScaffoldSkillArgs> = typeof rawNameOrArgs === 'string' ? {} : rawNameOrArgs
  const defaults = getSettings().skillDefaults
  const opts = {
    owner: requested.owner?.trim() || defaults.owner || undefined,
    lifecycle: requested.lifecycle?.toString().trim() || defaults.lifecycle || undefined,
    version: requested.version?.trim() || defaults.version,
    reviewIntervalDays: requested.reviewIntervalDays || defaults.reviewIntervalDays,
    channels: requested.channels && requested.channels.length > 0 ? requested.channels : defaults.channels,
    author: requested.author?.trim() || undefined,
    license: requested.license?.trim() || undefined,
    sourceType: requested.sourceType?.trim() || undefined
  }
  const name = slugify(rawName)
  if (!name) throw new Error('Please provide a valid skill name.')

  const work = await fs.mkdtemp(join(tmpdir(), 'skill-ui-'))
  try {
    try {
      await execFileAsync('npx', ['--yes', 'skills', 'init', name], {
        cwd: work,
        timeout: 90_000,
        windowsHide: true
      })
      const produced = join(work, name, 'SKILL.md')
      let content = await fs.readFile(produced, 'utf8')
      content = withLifecycleMetadata(content, opts)
      const meta = parseSkillMd(content, name)
      return { meta, files: [{ path: 'SKILL.md', content, encoding: 'utf8' }] }
    } catch {
      // Fallback: built-in template equivalent to `skills init` output.
      const content = template(name, opts)
      const meta = parseSkillMd(content, name)
      return { meta, files: [{ path: 'SKILL.md', content, encoding: 'utf8' }] }
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
