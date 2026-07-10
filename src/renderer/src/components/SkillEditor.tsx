import { useEffect, useMemo, useState } from 'react'
import { Download, UploadCloud, FileCode, AlertCircle } from 'lucide-react'
import type { SkillBundle, SkillFile } from '@shared/types'
import { api, unwrap } from '../api'
import { useApp } from '../context'
import Modal from './Modal'
import TargetPicker from './TargetPicker'
import { Spinner } from './Spinner'
import SkillFrontmatterForm from './SkillFrontmatterForm'
import {
  parseSkillMd,
  serializeSkillMd,
  slugify,
  validateFrontmatter,
  type FrontmatterData,
  type FrontmatterValue,
  type JsonErrorMap
} from '../lib/skillFrontmatter'
import { updateSkillFileContent } from '../lib/skillFiles'

interface SkillEditorProps {
  bundle: SkillBundle
  /** Whether the skill name (folder) can be edited (true for newly created skills). */
  nameEditable: boolean
}

export default function SkillEditor({ bundle, nameEditable }: SkillEditorProps) {
  const { clients, toast } = useApp()
  const [files, setFiles] = useState<SkillFile[]>(bundle.files)
  const [expandedFilePath, setExpandedFilePath] = useState<string | null>(null)
  const initialSkillMd = bundle.files.find((f) => f.path === 'SKILL.md')?.content ?? ''
  const initialParts = useMemo(() => parseSkillMd(initialSkillMd, bundle), [bundle, initialSkillMd])

  const [frontmatter, setFrontmatter] = useState<FrontmatterData>(initialParts.frontmatter)
  const [skillBody, setSkillBody] = useState(initialParts.body)

  useEffect(() => {
    setFrontmatter(initialParts.frontmatter)
    setSkillBody(initialParts.body)
    setFiles(bundle.files)
    setExpandedFilePath(null)
    setValidationErrors([])
    setJsonErrors({})
  }, [initialParts])

  const [installOpen, setInstallOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedTargets, setSelectedTargets] = useState<string[]>(
    clients.filter((c) => c.exists).map((c) => c.path)
  )
  const [note, setNote] = useState('')
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [jsonErrors, setJsonErrors] = useState<JsonErrorMap>({})
  const [busy, setBusy] = useState(false)

  const otherFiles = useMemo(
    () => files.filter((f) => f.path !== 'SKILL.md'),
    [files]
  )
  const rawName = String(frontmatter.name ?? '')
  const effectiveName = nameEditable ? slugify(rawName) : rawName
  const formErrors = useMemo(
    () => validateFrontmatter(frontmatter, effectiveName, jsonErrors),
    [effectiveName, frontmatter, jsonErrors]
  )

  function setFrontmatterField(key: string, value: FrontmatterValue) {
    setValidationErrors([])
    setFrontmatter((current) => ({ ...current, [key]: value }))
  }

  function setSkillBodyContent(value: string) {
    setValidationErrors([])
    setSkillBody(value)
  }

  function setAdditionalFileContent(path: string, content: string) {
    setValidationErrors([])
    setFiles((current) => updateSkillFileContent(current, path, content))
  }

  function setJsonError(id: string, message: string | null) {
    setJsonErrors((current) => {
      const next = { ...current }
      if (message) next[id] = message
      else delete next[id]
      return next
    })
  }

  function buildFiles(): SkillFile[] {
    const md: SkillFile = {
      path: 'SKILL.md',
      content: serializeSkillMd({ ...frontmatter, name: effectiveName }, skillBody),
      encoding: 'utf8'
    }
    return [md, ...otherFiles]
  }

  async function validateForUpload(): Promise<boolean> {
    if (formErrors.length > 0) return false
    const result = await unwrap(api.skills.validate({ name: effectiveName, files: buildFiles() }))
    setValidationErrors(result.errors)
    return result.valid
  }

  async function openUploadModal() {
    setBusy(true)
    try {
      await validateForUpload()
      setUploadOpen(true)
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function doInstall() {
    if (formErrors.length > 0) {
      return toast({ kind: 'error', message: 'Please fix the frontmatter form before installing.' })
    }
    if (selectedTargets.length === 0) {
      return toast({ kind: 'error', message: 'Select at least one target directory.' })
    }

    setBusy(true)
    try {
      const res = await unwrap(
        api.skills.saveLocal({ name: effectiveName, files: buildFiles(), targetDirs: selectedTargets })
      )
      toast({
        kind: 'success',
        message: `Installed “${effectiveName}” to ${res.installed.length} location${res.installed.length === 1 ? '' : 's'}.`
      })
      setInstallOpen(false)
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function doUpload() {
    const valid = await validateForUpload()
    if (!valid) {
      return toast({ kind: 'error', message: 'Please fix the skill validation issues before opening a pull request.' })
    }

    setBusy(true)
    try {
      const res = await unwrap(
        api.skills.upload({ name: effectiveName, files: buildFiles(), note: note || undefined })
      )
      toast({
        kind: 'success',
        timeout: 0,
        message: (
          <span>
            Pull request opened. To view the PR, click this link:{' '}
            <a href={res.prUrl} className="link" target="_blank" rel="noreferrer">
              #{res.prNumber}
            </a>
          </span>
        )
      })
      setUploadOpen(false)
      setNote('')
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <SkillFrontmatterForm
        frontmatter={frontmatter}
        effectiveName={effectiveName}
        nameEditable={nameEditable}
        errors={formErrors}
        onChange={setFrontmatterField}
        onJsonError={setJsonError}
      />

      <div className="field">
        <label>SKILL.md content</label>
        <span className="hint">
          Edit only the Markdown body here. Frontmatter is managed by the form above and reconstructed on install/upload.
        </span>
        <textarea
          className="code"
          value={skillBody}
          spellCheck={false}
          onChange={(event) => setSkillBodyContent(event.target.value)}
        />
      </div>

      {otherFiles.length > 0 && (
        <div className="field">
          <label>Additional files ({otherFiles.length})</label>
          <div className="list">
            {otherFiles.map((file) => {
              const expanded = expandedFilePath === file.path
              return (
                <div className="additional-file" key={file.path}>
                  <button
                    type="button"
                    className={`list-row file-row-button${expanded ? ' active' : ''}`}
                    onClick={() => setExpandedFilePath(expanded ? null : file.path)}
                    aria-expanded={expanded}
                  >
                    <FileCode size={16} color="var(--text-faint)" />
                    <div className="grow">
                      <div className="mono">{file.path}</div>
                    </div>
                    <span className="badge gray">{file.encoding === 'base64' ? 'binary' : 'text'}</span>
                  </button>
                  {expanded && (
                    file.encoding === 'utf8' ? (
                      <textarea
                        className="code additional-file-editor"
                        value={file.content}
                        spellCheck={false}
                        aria-label={`Edit ${file.path}`}
                        onChange={(event) => setAdditionalFileContent(file.path, event.target.value)}
                      />
                    ) : (
                      <div className="additional-file-note">
                        Binary files are preserved on install and upload but cannot be viewed as text.
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>
          <span className="hint">These files are preserved on install and upload.</span>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="banner warn" style={{ alignItems: 'flex-start', marginTop: 12 }}>
          <AlertCircle size={18} color="var(--amber)" />
          <div className="banner-text">
            <strong>Validation issues</strong>
            <ul className="validation-list">
              {validationErrors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn primary" onClick={() => setInstallOpen(true)} disabled={formErrors.length > 0}>
          <Download size={15} /> Install locally
        </button>
        <button className="btn" onClick={openUploadModal} disabled={busy || formErrors.length > 0}>
          <UploadCloud size={15} /> Upload to repository
        </button>
      </div>

      {installOpen && (
        <Modal
          title="Install skill locally"
          subtitle="Choose which client directories to install this skill into."
          onClose={() => !busy && setInstallOpen(false)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setInstallOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button className="btn primary" onClick={doInstall} disabled={busy || formErrors.length > 0}>
                {busy ? <Spinner /> : <Download size={15} />} Install
              </button>
            </>
          }
        >
          <TargetPicker clients={clients} selected={selectedTargets} onChange={setSelectedTargets} />
        </Modal>
      )}

      {uploadOpen && (
        <Modal
          title="Upload to skill repository"
          subtitle="This opens a pull request so the skill can be reviewed before it is published."
          onClose={() => !busy && setUploadOpen(false)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setUploadOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button className="btn primary" onClick={doUpload} disabled={busy || validationErrors.length > 0 || formErrors.length > 0}>
                {busy ? <Spinner /> : <UploadCloud size={15} />} Open pull request
              </button>
            </>
          }
        >
          {validationErrors.length > 0 ? (
            <ValidationSummary errors={validationErrors} />
          ) : (
            <div className="banner" style={{ marginBottom: 14 }}>
              <FileCode size={18} color="var(--green)" />
              <div className="banner-text">
                <strong>Skill validation passed</strong>
                <span>SKILL.md and supporting files look ready to upload.</span>
              </div>
            </div>
          )}
          <div className="field">
            <label>Note (optional)</label>
            <span className="hint">Added to the pull request description.</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ minHeight: 90 }}
              placeholder="What does this skill do / what changed?"
            />
          </div>
        </Modal>
      )}
    </div>
  )
}

function ValidationSummary({ errors }: { errors: string[] }) {
  return (
    <div className="banner warn" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
      <AlertCircle size={18} color="var(--amber)" />
      <div className="banner-text">
        <strong>This skill needs a few fixes before it can be uploaded</strong>
        <ul className="validation-list">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      </div>
    </div>
  )
}
