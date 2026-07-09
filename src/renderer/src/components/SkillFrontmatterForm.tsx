import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import {
  additionalTopLevelFields,
  fieldLabel,
  formatValue,
  isRecord,
  LIFECYCLES,
  metadataObject,
  parseList,
  SKILL_NAME_RE,
  toFrontmatterValue,
  VERSION_RE,
  type FrontmatterData,
  type FrontmatterValue
} from '../lib/skillFrontmatter'

interface SkillFrontmatterFormProps {
  frontmatter: FrontmatterData
  effectiveName: string
  nameEditable: boolean
  errors: string[]
  onChange: (key: string, value: FrontmatterValue) => void
  onJsonError: (id: string, message: string | null) => void
}

function JsonValueField({
  id,
  label,
  value,
  onChange,
  onError
}: {
  id: string
  label: string
  value: FrontmatterValue
  onChange: (value: FrontmatterValue) => void
  onError: (id: string, message: string | null) => void
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))

  useEffect(() => {
    setText(JSON.stringify(value, null, 2))
  }, [value])

  return (
    <div className="field">
      <label>{label}</label>
      <textarea
        className="json-field"
        value={text}
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          try {
            onChange(toFrontmatterValue(JSON.parse(next)))
            onError(id, null)
          } catch (err) {
            onError(id, (err as Error).message)
          }
        }}
      />
    </div>
  )
}

function FrontmatterValueField({
  id,
  fieldKey,
  value,
  onChange,
  onError
}: {
  id: string
  fieldKey: string
  value: FrontmatterValue
  onChange: (value: FrontmatterValue) => void
  onError: (id: string, message: string | null) => void
}) {
  const label = fieldLabel(fieldKey)

  if (fieldKey === 'lifecycle' && typeof value === 'string') {
    return (
      <div className="field">
        <label>{label}</label>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {LIFECYCLES.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <div className="field">
        <label>{label}</label>
        <select value={String(value)} onChange={(event) => onChange(event.target.value === 'true')}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </div>
    )
  }

  if (typeof value === 'number') {
    return (
      <div className="field">
        <label>{label}</label>
        <input
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
        />
      </div>
    )
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return (
      <div className="field">
        <label>{label}</label>
        <input type="text" value={formatValue(value)} onChange={(event) => onChange(parseList(event.target.value))} />
        <span className="hint">Comma-separated list.</span>
      </div>
    )
  }

  if (isRecord(value)) {
    return (
      <div className="frontmatter-section nested">
        <div className="frontmatter-section-title">{label}</div>
        <FrontmatterObjectFields baseId={id} value={value} onChange={onChange} onError={onError} />
      </div>
    )
  }

  if (Array.isArray(value)) {
    return <JsonValueField id={id} label={label} value={value} onChange={onChange} onError={onError} />
  }

  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" value={formatValue(value)} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function FrontmatterObjectFields({
  baseId,
  value,
  onChange,
  onError
}: {
  baseId: string
  value: Record<string, FrontmatterValue>
  onChange: (value: FrontmatterValue) => void
  onError: (id: string, message: string | null) => void
}) {
  const entries = Object.entries(value)
  if (entries.length === 0) return <span className="hint">No fields yet.</span>

  return (
    <div className="frontmatter-grid">
      {entries.map(([key, item]) => (
        <FrontmatterValueField
          key={`${baseId}.${key}`}
          id={`${baseId}.${key}`}
          fieldKey={key}
          value={item}
          onChange={(next) => onChange({ ...value, [key]: next })}
          onError={onError}
        />
      ))}
    </div>
  )
}

export default function SkillFrontmatterForm({
  frontmatter,
  effectiveName,
  nameEditable,
  errors,
  onChange,
  onJsonError
}: SkillFrontmatterFormProps) {
  const rawName = String(frontmatter.name ?? '')
  const metadata = metadataObject(frontmatter)
  const optionalTopLevel = additionalTopLevelFields(frontmatter)
  const [metadataExpanded, setMetadataExpanded] = useState(false)

  return (
    <div className="frontmatter-card">
      <div className="frontmatter-heading">
        <div>
          <h2>Skill frontmatter</h2>
          <p>Structured metadata is written back to the YAML block at the top of SKILL.md.</p>
        </div>
        {errors.length === 0 ? (
          <span className="badge green">valid</span>
        ) : (
          <span className="badge amber">{errors.length} issue{errors.length === 1 ? '' : 's'}</span>
        )}
      </div>

      <div className="frontmatter-grid primary-fields">
        <div className="field">
          <label>Skill name</label>
          <input
            type="text"
            value={rawName}
            disabled={!nameEditable}
            pattern={SKILL_NAME_RE.source}
            onChange={(event) => onChange('name', event.target.value)}
            placeholder="my-skill"
          />
          {nameEditable && effectiveName !== rawName && (
            <span className="hint">Folder will be: {effectiveName || '—'}</span>
          )}
        </div>

        <div className="field">
          <label>Version</label>
          <input
            type="text"
            value={formatValue(frontmatter.version)}
            pattern={VERSION_RE.source}
            onChange={(event) => onChange('version', event.target.value)}
            placeholder="1.0.0"
          />
        </div>

        <div className="field wide">
          <label>Description</label>
          <textarea
            className="compact"
            value={formatValue(frontmatter.description)}
            required
            onChange={(event) => onChange('description', event.target.value)}
            placeholder="When should an agent use this skill?"
          />
        </div>

        <div className="field">
          <label>Author</label>
          <input
            type="text"
            value={formatValue(frontmatter.author)}
            onChange={(event) => onChange('author', event.target.value)}
            placeholder="Author or team"
          />
        </div>

        <div className="field">
          <label>License</label>
          <input
            type="text"
            value={formatValue(frontmatter.license)}
            onChange={(event) => onChange('license', event.target.value)}
            placeholder="MIT"
          />
        </div>
      </div>

      {optionalTopLevel.length > 0 && (
        <div className="frontmatter-section">
          <div className="frontmatter-section-title">Additional frontmatter</div>
          <div className="frontmatter-grid">
            {optionalTopLevel.map(([key, value]) => (
              <FrontmatterValueField
                key={key}
                id={key}
                fieldKey={key}
                value={value}
                onChange={(next) => onChange(key, next)}
                onError={onJsonError}
              />
            ))}
          </div>
        </div>
      )}

      <div className="frontmatter-section metadata-section">
        <button
          type="button"
          className="metadata-toggle"
          aria-expanded={metadataExpanded}
          onClick={() => setMetadataExpanded((expanded) => !expanded)}
        >
          <span className="metadata-toggle-icon" aria-hidden="true">{metadataExpanded ? '▾' : '▸'}</span>
          <span>Metadata</span>
        </button>
        {metadataExpanded && (
          <FrontmatterObjectFields
            baseId="metadata"
            value={metadata}
            onChange={(next) => onChange('metadata', next)}
            onError={onJsonError}
          />
        )}
      </div>

      {errors.length > 0 && (
        <div className="banner warn frontmatter-errors">
          <AlertCircle size={18} color="var(--amber)" />
          <div className="banner-text">
            <strong>Frontmatter needs fixes</strong>
            <ul className="validation-list">
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
