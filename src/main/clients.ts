import { homedir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'
import type { ClientTarget } from '@shared/types'
import { getSettings } from './settings'

/**
 * Built-in client definitions with their default global skills directories.
 *
 *   Claude Desktop -> ~/.claude/skills
 *   Hermes         -> ~/.hermes/skills
 *   Copilot/VSCode -> ~/.copilot/skills
 *   npx skills     -> project/local copied skills directory when configured as custom
 *
 * These mirror local-folder integration points. Native CLI adapters can report
 * blocked/unsupported separately when the external command is unavailable.
 */
interface ClientDef {
  id: string
  label: string
  dir: () => string
}

const CLIENT_DEFS: ClientDef[] = [
  {
    id: 'claude',
    label: 'Claude',
    dir: () => join(homedir(), '.claude', 'skills')
  },
  {
    id: 'hermes',
    label: 'Hermes',
    dir: () => join(homedir(), '.hermes', 'skills')
  },
  {
    id: 'copilot',
    label: 'Copilot / VS Code',
    dir: () => join(homedir(), '.copilot', 'skills')
  }
]

/** Return all known client targets plus the configured custom directory. */
export function detectClients(): ClientTarget[] {
  const targets: ClientTarget[] = CLIENT_DEFS.map((c) => {
    const path = c.dir()
    return { id: c.id, label: c.label, path, exists: existsSync(path) }
  })

  const { customSkillsDir } = getSettings()
  if (customSkillsDir && customSkillsDir.trim()) {
    targets.push({
      id: 'custom',
      label: 'Custom directory',
      path: customSkillsDir.trim(),
      exists: existsSync(customSkillsDir.trim()),
      custom: true
    })
  }

  return targets
}

/** Map an absolute skills directory back to a client id (best effort). */
export function clientIdForDir(dir: string): string {
  const match = detectClients().find((c) => c.path === dir)
  return match?.id ?? 'custom'
}
