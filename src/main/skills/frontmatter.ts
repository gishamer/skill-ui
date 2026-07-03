import { createHash } from 'crypto'
import matter from 'gray-matter'
import type { SkillMeta } from '@shared/types'

/** Compute a stable sha256 of a string (used as a content based version signal). */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Parse a SKILL.md document into metadata.
 *
 * Supported frontmatter shape:
 *   ---
 *   name: my-skill
 *   description: ...
 *   metadata:
 *     version: 1.2.0
 *   ---
 *
 * `version` is also accepted at the top level for convenience.
 */
export function parseSkillMd(content: string, fallbackName: string): SkillMeta {
  let data: Record<string, unknown> = {}
  try {
    data = matter(content).data ?? {}
  } catch {
    data = {}
  }

  const name =
    typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName

  const description =
    typeof data.description === 'string' ? data.description.trim() : ''

  const metadata = (data.metadata ?? {}) as Record<string, unknown>
  const organization = (metadata.organization && typeof metadata.organization === 'object' && !Array.isArray(metadata.organization)
    ? metadata.organization
    : {}) as Record<string, unknown>
  const rawVersion = metadata.version ?? organization.version ?? (data as Record<string, unknown>).version
  const version =
    typeof rawVersion === 'string' || typeof rawVersion === 'number'
      ? String(rawVersion).trim()
      : null

  return { name, description, version, hash: sha256(content) }
}

/**
 * Compare two semver-ish version strings.
 * Returns 1 if a > b, -1 if a < b, 0 if equal/incomparable.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10))
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0
    const y = Number.isFinite(pb[i]) ? pb[i] : 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}
