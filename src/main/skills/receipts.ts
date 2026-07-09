import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type { InstallReceipt, ClientId } from '@shared/types'

export const RECEIPT_SCHEMA_VERSION = 1

function stateRoot(): string {
  return process.env.SKILL_UI_HOME ? path.resolve(process.env.SKILL_UI_HOME) : path.join(os.homedir(), '.skill-ui')
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function receiptsRoot(): string {
  return process.env.SKILL_UI_RECEIPTS_DIR
    ? path.resolve(process.env.SKILL_UI_RECEIPTS_DIR)
    : path.join(stateRoot(), 'receipts')
}

export function receiptPath(client: ClientId | string, skill: string): string {
  return path.join(receiptsRoot(), safeSegment(client), `${safeSegment(skill)}.json`)
}

export function normalizeReceipt(input: unknown): InstallReceipt | null {
  if (typeof input !== 'object' || input === null) return null
  const candidate = input as Partial<InstallReceipt>
  if (candidate.schemaVersion !== RECEIPT_SCHEMA_VERSION) return null
  if (typeof candidate.client !== 'string' || typeof candidate.skill !== 'string') return null
  if (typeof candidate.sourceBundleHash !== 'string') return null
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    client: candidate.client,
    skill: candidate.skill,
    sourceRepo: typeof candidate.sourceRepo === 'string' ? candidate.sourceRepo : '',
    sourcePath: typeof candidate.sourcePath === 'string' ? candidate.sourcePath : '',
    sourceRef: typeof candidate.sourceRef === 'string' ? candidate.sourceRef : '',
    sourceCommit: typeof candidate.sourceCommit === 'string' ? candidate.sourceCommit : null,
    sourceBundleHash: candidate.sourceBundleHash,
    installMethod: candidate.installMethod === 'native' ? 'native' : 'managed-copy',
    marketplaceName: typeof candidate.marketplaceName === 'string' ? candidate.marketplaceName : null,
    installedPaths: Array.isArray(candidate.installedPaths) ? candidate.installedPaths.filter((p): p is string => typeof p === 'string') : [],
    installedBundleHash: typeof candidate.installedBundleHash === 'string' ? candidate.installedBundleHash : null,
    installedAt: typeof candidate.installedAt === 'string' ? candidate.installedAt : new Date().toISOString(),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString()
  }
}

export async function readReceipt(client: ClientId | string, skill: string): Promise<InstallReceipt | null> {
  try {
    const raw = JSON.parse(await fs.readFile(receiptPath(client, skill), 'utf8'))
    return normalizeReceipt(raw)
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') return null
    return null
  }
}

export async function writeReceipt(receipt: InstallReceipt): Promise<InstallReceipt> {
  const normalized = normalizeReceipt({ ...receipt, schemaVersion: RECEIPT_SCHEMA_VERSION })
  if (!normalized) throw new Error('Invalid install receipt')
  const dest = receiptPath(normalized.client, normalized.skill)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, JSON.stringify(normalized, null, 2) + '\n', { mode: 0o600 })
  return normalized
}

export async function deleteReceipt(client: ClientId | string, skill: string): Promise<void> {
  await fs.rm(receiptPath(client, skill), { force: true })
}

export async function listReceipts(): Promise<InstallReceipt[]> {
  const root = receiptsRoot()
  const out: InstallReceipt[] = []
  let clients: string[] = []
  try {
    clients = await fs.readdir(root)
  } catch {
    return out
  }
  for (const client of clients) {
    let files: string[] = []
    try {
      files = await fs.readdir(path.join(root, client))
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = JSON.parse(await fs.readFile(path.join(root, client, file), 'utf8'))
        const receipt = normalizeReceipt(raw)
        if (receipt) out.push(receipt)
      } catch {
        // Ignore malformed receipts in list mode; readReceipt returns null for them too.
      }
    }
  }
  return out.sort((a, b) => `${a.client}/${a.skill}`.localeCompare(`${b.client}/${b.skill}`))
}
