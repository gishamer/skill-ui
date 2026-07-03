import type { KeyboardEvent } from 'react'
import type { ClientTarget } from '@shared/types'

interface TargetPickerProps {
  clients: ClientTarget[]
  selected: string[]
  onChange: (paths: string[]) => void
}

/** Multi-select list of client directories to install a skill into. */
export default function TargetPicker({ clients, selected, onChange }: TargetPickerProps) {
  function toggle(path: string) {
    onChange(selected.includes(path) ? selected.filter((p) => p !== path) : [...selected, path])
  }

  function toggleWithKeyboard(event: KeyboardEvent<HTMLDivElement>, path: string) {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    toggle(path)
  }

  if (clients.length === 0) {
    return (
      <p className="hint">
        No client directories detected. Add a custom directory in Settings.
      </p>
    )
  }

  return (
    <div>
      {clients.map((c) => {
        const checked = selected.includes(c.path)
        return (
          <div
            key={c.path}
            className={`checkbox-row ${checked ? 'checked' : ''}`}
            role="checkbox"
            aria-checked={checked}
            tabIndex={0}
            onClick={() => toggle(c.path)}
            onKeyDown={(event) => toggleWithKeyboard(event, c.path)}
          >
            <input type="checkbox" checked={checked} readOnly tabIndex={-1} aria-hidden="true" />
            <div className="grow">
              <div className="cr-label">
                {c.label}
                {!c.exists && (
                  <span className="badge gray" style={{ marginLeft: 8 }}>
                    will be created
                  </span>
                )}
              </div>
              <div className="cr-path">{c.path}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
