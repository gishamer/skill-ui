import type { SkillBundle } from '@shared/types'

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue }

export type FrontmatterData = Record<string, FrontmatterValue>
export type JsonErrorMap = Record<string, string>

export const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
export const VERSION_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
export const LIFECYCLES = ['experimental', 'review', 'active', 'maintain', 'deprecated', 'archived']

const TOP_LEVEL_FIELDS = new Set(['name', 'description', 'version', 'author', 'license', 'metadata'])

interface FrontmatterSplit {
  yaml: string
  body: string
}

function splitFrontmatterBlock(content: string): FrontmatterSplit | null {
  const document = content.trimStart()
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(document)
  if (!match) return null
  return { yaml: match[1], body: document.slice(match[0].length).replace(/^\r?\n/, '') }
}

export function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function isRecord(value: unknown): value is Record<string, FrontmatterValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toFrontmatterValue(value: unknown): FrontmatterValue {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(toFrontmatterValue)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toFrontmatterValue(item)])
    )
  }
  return String(value)
}

export function parseSkillMd(content: string, bundle: SkillBundle): { frontmatter: FrontmatterData; body: string } {
  try {
    const split = splitFrontmatterBlock(content)
    const data = split ? parseYamlObject(split.yaml) : {}

    return {
      frontmatter: {
        name: String(data.name ?? bundle.meta.name),
        description: String(data.description ?? bundle.meta.description ?? ''),
        ...(!split && bundle.meta.version ? { version: bundle.meta.version } : {}),
        ...data,
        metadata: isRecord(data.metadata) ? data.metadata : {}
      },
      body: split ? split.body : content
    }
  } catch {
    return {
      frontmatter: {
        name: bundle.meta.name,
        description: bundle.meta.description,
        ...(bundle.meta.version ? { version: bundle.meta.version } : {}),
        metadata: {}
      },
      body: splitFrontmatterBlock(content)?.body ?? content
    }
  }
}

function parseYamlObject(yaml: string): FrontmatterData {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n')
  const root: FrontmatterData = {}
  const stack: { indent: number; value: Record<string, FrontmatterValue> | FrontmatterValue[] }[] = [
    { indent: -1, value: root }
  ]

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue

    const indent = raw.match(/^ */)?.[0].length ?? 0
    const text = raw.trim()
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()

    const parent = stack[stack.length - 1].value
    if (text === '-' || text.startsWith('- ')) {
      if (!Array.isArray(parent)) continue
      const itemText = text === '-' ? '' : text.slice(2).trim()
      const objectEntry = parseKeyValue(itemText)
      if (objectEntry) {
        const item: FrontmatterData = {}
        parent.push(item)
        const [key, valueText] = objectEntry
        if (valueText) item[key] = parseScalar(valueText)
        else {
          const child: FrontmatterData = {}
          item[key] = child
          stack.push({ indent: indent + 2, value: child })
        }
        stack.push({ indent, value: item })
      } else if (itemText) {
        parent.push(parseScalar(itemText))
      } else {
        const item: FrontmatterData = {}
        parent.push(item)
        stack.push({ indent, value: item })
      }
      continue
    }

    const entry = parseKeyValue(text)
    if (!entry || Array.isArray(parent)) continue
    const [key, valueText] = entry
    if (valueText) {
      parent[key] = parseScalar(valueText)
    } else {
      const child: FrontmatterData | FrontmatterValue[] = nextLineIsList(lines, index, indent) ? [] : {}
      parent[key] = child
      stack.push({ indent, value: child })
    }
  }

  return root
}

function parseKeyValue(text: string): [string, string] | null {
  const match = /^([^:]+):(.*)$/.exec(text)
  if (!match) return null
  return [match[1].trim(), match[2].trim()]
}

function nextLineIsList(lines: string[], index: number, parentIndent: number): boolean {
  for (let next = index + 1; next < lines.length; next++) {
    const raw = lines[next]
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const indent = raw.match(/^ */)?.[0].length ?? 0
    return indent > parentIndent && raw.trim().startsWith('-')
  }
  return false
}

function parseScalar(text: string): FrontmatterValue {
  if (text === 'null' || text === '~') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return text
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim()
    return inner ? inner.split(',').map((item) => parseScalar(item.trim())) : []
  }
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  return text
}

function cleanFrontmatter(value: FrontmatterValue): FrontmatterValue | undefined {
  if (value === null) return undefined
  if (typeof value === 'string') return value.trim() ? value.trim() : undefined
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const items = value.map(cleanFrontmatter).filter((item): item is FrontmatterValue => item !== undefined)
    return items.length > 0 ? items : undefined
  }

  const out: Record<string, FrontmatterValue> = {}
  for (const [key, item] of Object.entries(value)) {
    const cleaned = cleanFrontmatter(item)
    if (cleaned !== undefined) out[key] = cleaned
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function serializeSkillMd(frontmatter: FrontmatterData, body: string): string {
  const cleaned = cleanFrontmatter(frontmatter) as FrontmatterData | undefined
  return ['---', stringifyYaml(cleaned ?? { name: 'skill', description: '' }), '---', body.trimStart()].join('\n').trimEnd() + '\n'
}

function stringifyYaml(value: FrontmatterValue, indent = 0): string {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (isRecord(item) || Array.isArray(item)) return `${pad}-\n${stringifyYaml(item, indent + 2)}`
      return `${pad}- ${formatYamlScalar(item)}`
    }).join('\n')
  }
  if (isRecord(value)) {
    return Object.entries(value).map(([key, item]) => {
      if (isRecord(item) || Array.isArray(item)) return `${pad}${key}:\n${stringifyYaml(item, indent + 2)}`
      return `${pad}${key}: ${formatYamlScalar(item)}`
    }).join('\n')
  }
  return `${pad}${formatYamlScalar(value)}`
}

function formatYamlScalar(value: FrontmatterValue): string {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'string') return JSON.stringify(value)
  if (/^[a-z0-9._/-]+$/i.test(value)) return value
  return JSON.stringify(value)
}

export function parseList(input: string): string[] {
  return input.split(',').map((item) => item.trim()).filter(Boolean)
}

export function formatValue(value: FrontmatterValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  return String(value)
}

export function fieldLabel(key: string): string {
  return key.replace(/[_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function metadataObject(frontmatter: FrontmatterData): Record<string, FrontmatterValue> {
  return isRecord(frontmatter.metadata) ? frontmatter.metadata : {}
}

export function additionalTopLevelFields(frontmatter: FrontmatterData): [string, FrontmatterValue][] {
  return Object.entries(frontmatter).filter(([key]) => !TOP_LEVEL_FIELDS.has(key))
}

export function validateFrontmatter(
  frontmatter: FrontmatterData,
  effectiveName: string,
  jsonErrors: JsonErrorMap
): string[] {
  const errors: string[] = []
  if (!effectiveName || !SKILL_NAME_RE.test(effectiveName)) {
    errors.push('Skill name must be lowercase, hyphen-separated, and at most 64 characters.')
  }
  if (!String(frontmatter.description ?? '').trim()) {
    errors.push('Description is required.')
  }

  const version = String(frontmatter.version ?? '').trim()
  if (version && !VERSION_RE.test(version)) {
    errors.push('Version must look like semantic versioning, e.g. 1.2.3 or v1.2.3-beta.')
  }

  for (const [id, message] of Object.entries(jsonErrors)) {
    errors.push(`${id}: invalid JSON (${message})`)
  }
  return errors
}
