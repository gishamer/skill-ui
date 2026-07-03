import Store from 'electron-store'
import { safeStorage } from 'electron'
import type { AppSettings } from '@shared/types'

interface StoreShape {
  repoOwner: string
  repoName: string
  repoBranch: string
  repoSkillsPath: string
  repoDir: string
  customSkillsDir: string
  /** Encrypted (or plain, as fallback) GitHub token. */
  tokenEnc: string
  /** Whether tokenEnc is encrypted with safeStorage. */
  tokenEncrypted: boolean
}

const store = new Store<StoreShape>({
  name: 'skill-ui-settings',
  defaults: {
    repoOwner: 'gishamer',
    repoName: 'skills',
    repoBranch: 'main',
    repoSkillsPath: '',
    repoDir: '',
    customSkillsDir: '',
    tokenEnc: '',
    tokenEncrypted: false
  }
})

/** Public settings, never exposing the raw token. */
export function getSettings(): AppSettings {
  return {
    repoOwner: store.get('repoOwner'),
    repoName: store.get('repoName'),
    repoBranch: store.get('repoBranch'),
    repoSkillsPath: store.get('repoSkillsPath'),
    repoDir: store.get('repoDir'),
    customSkillsDir: store.get('customSkillsDir'),
    hasToken: !!store.get('tokenEnc')
  }
}

/** Persist a settings patch. A provided `token` is stored encrypted at rest. */
export function setSettings(patch: Partial<AppSettings> & { token?: string }): AppSettings {
  const assignable: (keyof AppSettings)[] = [
    'repoOwner',
    'repoName',
    'repoBranch',
    'repoSkillsPath',
    'repoDir',
    'customSkillsDir'
  ]
  for (const key of assignable) {
    const value = patch[key]
    if (typeof value === 'string') store.set(key, value)
  }

  if (typeof patch.token === 'string') {
    if (patch.token === '') {
      store.set('tokenEnc', '')
      store.set('tokenEncrypted', false)
    } else if (safeStorage.isEncryptionAvailable()) {
      store.set('tokenEnc', safeStorage.encryptString(patch.token).toString('base64'))
      store.set('tokenEncrypted', true)
    } else {
      // Fallback: store as-is when OS encryption is unavailable.
      store.set('tokenEnc', Buffer.from(patch.token, 'utf8').toString('base64'))
      store.set('tokenEncrypted', false)
    }
  }

  return getSettings()
}

/** Decrypt and return the stored GitHub token, or empty string if none. */
export function getToken(): string {
  const enc = store.get('tokenEnc')
  if (!enc) return ''
  const buf = Buffer.from(enc, 'base64')
  if (store.get('tokenEncrypted')) {
    try {
      return safeStorage.decryptString(buf)
    } catch {
      return ''
    }
  }
  return buf.toString('utf8')
}
