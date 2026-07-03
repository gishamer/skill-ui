import type { SkillUiApi } from '@shared/types'

declare global {
  interface Window {
    api: SkillUiApi
  }
}

export {}
