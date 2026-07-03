import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import matter from 'gray-matter'
import type { SkillBundle } from '@shared/types'
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

function template(name: string, opts: { owner?: string; lifecycle?: string } = {}): string {
  const title = name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const owner = opts.owner?.trim() || 'TODO: set owning GitHub team'
  const lifecycle = opts.lifecycle?.trim() || 'experimental'
  return `---
name: ${name}
description: Describe what this skill does and, importantly, when the agent should use it.
metadata:
  organization:
    owner: ${yamlString(owner)}
    lifecycle: ${lifecycle}
    version: "0.1.0"
    review_interval_days: 180
    channels:
      - developer
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

function withLifecycleMetadata(content: string, opts: { owner?: string; lifecycle?: string }): string {
  if (!opts.owner?.trim() && !opts.lifecycle?.trim()) return content
  const parsed = matter(content)
  const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : {}) as Record<string, unknown>
  const metadata = (data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata
    : {}) as Record<string, unknown>
  const organization = (metadata.organization && typeof metadata.organization === 'object' && !Array.isArray(metadata.organization)
    ? metadata.organization
    : {}) as Record<string, unknown>
  metadata.organization = {
    ...organization,
    owner: opts.owner?.trim() || organization.owner || 'TODO: set owning GitHub team',
    lifecycle: opts.lifecycle?.trim() || organization.lifecycle || 'experimental',
    version: organization.version || metadata.version || '0.1.0',
    review_interval_days: organization.review_interval_days || 180,
    channels: organization.channels || ['developer']
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
  rawNameOrArgs: string | { name: string; owner?: string; lifecycle?: string }
): Promise<SkillBundle> {
  const rawName = typeof rawNameOrArgs === 'string' ? rawNameOrArgs : rawNameOrArgs.name
  const opts = typeof rawNameOrArgs === 'string' ? {} : rawNameOrArgs
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
