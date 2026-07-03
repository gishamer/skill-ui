import { useMemo, useState } from 'react'
import { Download, UploadCloud, FileCode, AlertCircle } from 'lucide-react'
import type { SkillBundle, SkillFile } from '@shared/types'
import { api, unwrap } from '../api'
import { useApp } from '../context'
import Modal from './Modal'
import TargetPicker from './TargetPicker'
import { Spinner } from './Spinner'

interface SkillEditorProps {
  bundle: SkillBundle
  /** Whether the skill name (folder) can be edited (true for newly created skills). */
  nameEditable: boolean
}

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export default function SkillEditor({ bundle, nameEditable }: SkillEditorProps) {
  const { clients, toast } = useApp()
  const [name, setName] = useState(bundle.meta.name)
  const initialSkillMd = bundle.files.find((f) => f.path === 'SKILL.md')?.content ?? ''
  const [skillMd, setSkillMd] = useState(initialSkillMd)

  const otherFiles = useMemo(
    () => bundle.files.filter((f) => f.path !== 'SKILL.md'),
    [bundle.files]
  )

  const [installOpen, setInstallOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedTargets, setSelectedTargets] = useState<string[]>(
    clients.filter((c) => c.exists).map((c) => c.path)
  )
  const [note, setNote] = useState('')
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  function buildFiles(): SkillFile[] {
    const md: SkillFile = { path: 'SKILL.md', content: skillMd, encoding: 'utf8' }
    return [md, ...otherFiles]
  }

  const effectiveName = nameEditable ? slugify(name) : name

  async function validateForUpload(): Promise<boolean> {
    if (!effectiveName) {
      setValidationErrors(['Please provide a skill name.'])
      return false
    }
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
    if (!effectiveName) return toast({ kind: 'error', message: 'Please provide a skill name.' })
    if (selectedTargets.length === 0)
      return toast({ kind: 'error', message: 'Select at least one target directory.' })
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
      <div className="field">
        <label>Skill name</label>
        <input
          type="text"
          value={name}
          disabled={!nameEditable}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-skill"
        />
        {nameEditable && effectiveName !== name && (
          <span className="hint">Folder will be: {effectiveName || '—'}</span>
        )}
      </div>

      <div className="field">
        <label>SKILL.md</label>
        <span className="hint">
          Paste existing work, or edit the scaffolded template. Frontmatter drives the skill name,
          description and <span className="mono">metadata.organization.version</span> used for updates.
        </span>
        <textarea
          className="code"
          value={skillMd}
          spellCheck={false}
          onChange={(e) => setSkillMd(e.target.value)}
        />
      </div>

      {otherFiles.length > 0 && (
        <div className="field">
          <label>Additional files ({otherFiles.length})</label>
          <div className="list">
            {otherFiles.map((f) => (
              <div className="list-row" key={f.path}>
                <FileCode size={16} color="var(--text-faint)" />
                <div className="grow">
                  <div className="mono">{f.path}</div>
                </div>
                <span className="badge gray">{f.encoding === 'base64' ? 'binary' : 'text'}</span>
              </div>
            ))}
          </div>
          <span className="hint">These files are preserved on install and upload.</span>
        </div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn primary" onClick={() => setInstallOpen(true)}>
          <Download size={15} /> Install locally
        </button>
        <button className="btn" onClick={openUploadModal} disabled={busy}>
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
              <button className="btn primary" onClick={doInstall} disabled={busy}>
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
              <button className="btn primary" onClick={doUpload} disabled={busy || validationErrors.length > 0}>
                {busy ? <Spinner /> : <UploadCloud size={15} />} Open pull request
              </button>
            </>
          }
        >
          {validationErrors.length > 0 ? (
            <div className="banner warn" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
              <AlertCircle size={18} color="var(--amber)" />
              <div className="banner-text">
                <strong>This skill needs a few fixes before it can be uploaded</strong>
                <ul className="validation-list">
                  {validationErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
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
