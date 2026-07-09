import type { InstallReceipt, NativeInstallState } from '@shared/types'

export interface ClassificationInput {
  installedDetected: boolean
  installedInspectable: boolean
  currentRepoHash?: string | null
  installedHash?: string | null
  receipt?: InstallReceipt | null
  environmentStatus?: 'ok' | 'blocked' | 'unsupported'
  legacySymlink?: boolean
  knownHistoricalSourceHash?: string | null
}

export function classifyInstallState(input: ClassificationInput): NativeInstallState {
  if (input.environmentStatus === 'blocked') return 'blocked'
  if (input.environmentStatus === 'unsupported') return 'unsupported'
  if (input.legacySymlink) return 'legacy-symlink'
  if (!input.installedDetected) return 'not-installed'
  if (!input.installedInspectable || !input.installedHash || !input.currentRepoHash) return 'unknown'

  const current = input.currentRepoHash
  const installed = input.installedHash
  const receiptHash = input.receipt?.sourceBundleHash ?? null

  if (receiptHash) {
    if (installed === current) return 'current'
    if (installed === receiptHash && current !== receiptHash) return 'outdated'
    if (installed !== receiptHash && current === receiptHash) return 'locally-modified'
    if (installed !== receiptHash && current !== receiptHash) return 'diverged'
  }

  if (installed === current) return 'unmanaged-current'
  if (input.knownHistoricalSourceHash && installed !== current) return 'unmanaged-modified'
  return 'unmanaged-outdated'
}

export function nativeStateToLegacyUpdateState(state: NativeInstallState): 'up-to-date' | 'outdated' | 'not-in-repo' | 'unknown' | 'locally-modified' | 'diverged' | 'unmanaged' | 'blocked' | 'unsupported' | 'legacy-symlink' {
  if (state === 'current' || state === 'unmanaged-current') return 'up-to-date'
  if (state === 'outdated' || state === 'unmanaged-outdated') return 'outdated'
  if (state === 'locally-modified' || state === 'unmanaged-modified') return 'locally-modified'
  if (state === 'diverged') return 'diverged'
  if (state === 'blocked') return 'blocked'
  if (state === 'unsupported') return 'unsupported'
  if (state === 'legacy-symlink') return 'legacy-symlink'
  if (state === 'not-installed') return 'not-in-repo'
  return 'unknown'
}
