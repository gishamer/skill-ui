import type { SkillFile } from '@shared/types'

export function updateSkillFileContent(files: SkillFile[], path: string, content: string): SkillFile[] {
  return files.map((file) =>
    file.path === path && file.encoding === 'utf8'
      ? { ...file, content }
      : file
  )
}
