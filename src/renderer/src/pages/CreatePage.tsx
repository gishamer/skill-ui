import { useState } from 'react'
import { Sparkles, ArrowLeft, FolderOpen, CloudDownload } from 'lucide-react'
import type { ScaffoldSkillArgs, SkillBundle } from '@shared/types'
import { api, unwrap } from '../api'
import { useApp } from '../context'
import { Spinner } from '../components/Spinner'
import SkillEditor from '../components/SkillEditor'

const LIFECYCLES = ['experimental', 'review', 'active', 'maintain', 'deprecated', 'archived']
const CHANNELS = ['developer', 'runtime']

function parseChannels(text: string): string[] {
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

function optionalNumber(text: string): number | undefined {
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export default function CreatePage() {
  const { settings, toast } = useApp()
  const [name, setName] = useState('')
  const [createOwner, setCreateOwner] = useState(settings.skillDefaults.owner || '@your-org/your-team')
  const [createLifecycle, setCreateLifecycle] = useState(String(settings.skillDefaults.lifecycle || 'experimental'))
  const [createVersion, setCreateVersion] = useState(settings.skillDefaults.version || '0.1.0')
  const [createReviewInterval, setCreateReviewInterval] = useState(String(settings.skillDefaults.reviewIntervalDays || 180))
  const [createChannels, setCreateChannels] = useState((settings.skillDefaults.channels || ['developer']).join(', '))
  const [createAuthor, setCreateAuthor] = useState('')
  const [createLicense, setCreateLicense] = useState('MIT')
  const [createSourceType, setCreateSourceType] = useState('internal')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteName, setRemoteName] = useState('')
  const [remoteOwner, setRemoteOwner] = useState(settings.skillDefaults.owner || '@your-org/your-team')
  const [remoteLifecycle, setRemoteLifecycle] = useState(String(settings.skillDefaults.mirrorLifecycle || 'review'))
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<SkillBundle | null>(null)

  async function scaffold() {
    if (!name.trim()) return toast({ kind: 'error', message: 'Enter a name for the skill.' })
    setBusy(true)
    try {
      const scaffoldArgs: ScaffoldSkillArgs = {
        name: name.trim(),
        owner: createOwner.trim() || undefined,
        lifecycle: createLifecycle,
        version: createVersion.trim() || undefined,
        reviewIntervalDays: optionalNumber(createReviewInterval),
        channels: parseChannels(createChannels),
        author: createAuthor.trim() || undefined,
        license: createLicense.trim() || undefined,
        sourceType: createSourceType.trim() || undefined
      }
      const result = await unwrap(api.skills.scaffold(scaffoldArgs))
      setBundle(result)
      toast({ kind: 'info', message: `Scaffolded “${result.meta.name}”. Edit it below.` })
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function importFolder() {
    setBusy(true)
    try {
      const dir = await api.clients.pickDirectory()
      if (!dir) return

      const result = await unwrap(api.local.read(dir))
      if (!result.files.some((file) => file.path === 'SKILL.md')) {
        return toast({
          kind: 'error',
          message: 'The selected folder is not a skill folder because it does not contain SKILL.md.'
        })
      }

      setBundle(result)
      toast({
        kind: 'info',
        message: `Imported “${result.meta.name}” with ${result.files.length} file${result.files.length === 1 ? '' : 's'}.`
      })
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function importRemote() {
    if (!remoteUrl.trim()) return toast({ kind: 'error', message: 'Enter a GitHub URL for the remote skill.' })
    setBusy(true)
    try {
      const result = await unwrap(
        api.remote.import({
          url: remoteUrl.trim(),
          name: remoteName.trim() || undefined,
          owner: remoteOwner.trim() || undefined,
          lifecycle: remoteLifecycle
        })
      )
      setBundle(result)
      toast({
        kind: 'info',
        message: `Imported remote “${result.meta.name}” from ${result.remote.source} at ${result.remote.commit.slice(0, 7)}.`
      })
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (bundle) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>New skill</h1>
            <p>Edit SKILL.md and review any imported supporting files, then install locally or upload.</p>
          </div>
          <div className="head-actions">
            <button className="btn ghost" onClick={() => setBundle(null)}>
              <ArrowLeft size={15} /> Start over
            </button>
          </div>
        </div>
        <SkillEditor bundle={bundle} nameEditable />
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Create a skill</h1>
          <p>Scaffold a new skill or import an existing skill folder with references, scripts, and other supporting files.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 620 }}>
        <div className="field" style={{ marginBottom: 8 }}>
          <label>Skill name</label>
          <span className="hint">Lowercase, hyphen-separated, e.g. “pdf-extractor”.</span>
          <input
            type="text"
            value={name}
            autoFocus
            placeholder="my-skill"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && scaffold()}
          />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }} title="Owning team or maintainer written to metadata.organization.owner.">
            <label>Internal owner</label>
            <input
              type="text"
              value={createOwner}
              placeholder="@your-org/your-team"
              onChange={(e) => setCreateOwner(e.target.value)}
            />
            <span className="hint">Who reviews and maintains this skill.</span>
          </div>
          <div className="field" style={{ maxWidth: 220 }} title="Lifecycle communicates maturity. Use active only after review.">
            <label>Lifecycle</label>
            <select value={createLifecycle} onChange={(e) => setCreateLifecycle(e.target.value)}>
              {LIFECYCLES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <span className="hint">Start with experimental or review.</span>
          </div>
        </div>

        <details className="metadata-details">
          <summary title="Adjust optional metadata before the SKILL.md file is generated.">Skill metadata defaults</summary>
          <div className="frontmatter-grid" style={{ marginTop: 12 }}>
            <div className="field" title="Initial semantic version written to metadata.organization.version.">
              <label>Version</label>
              <input type="text" value={createVersion} placeholder="0.1.0" onChange={(e) => setCreateVersion(e.target.value)} />
            </div>
            <div className="field" title="How often the owner should review this skill, in days.">
              <label>Review interval days</label>
              <input type="number" min="1" value={createReviewInterval} onChange={(e) => setCreateReviewInterval(e.target.value)} />
            </div>
            <div className="field" title="Comma-separated publication/consumer channels. Common values: developer, runtime.">
              <label>Channels</label>
              <input type="text" value={createChannels} onChange={(e) => setCreateChannels(e.target.value)} />
              <span className="hint">Common: {CHANNELS.join(', ')}.</span>
            </div>
            <div className="field" title="Optional top-level author field. Leave blank to omit it.">
              <label>Author</label>
              <input type="text" value={createAuthor} placeholder="Author or team" onChange={(e) => setCreateAuthor(e.target.value)} />
            </div>
            <div className="field" title="Optional top-level license field. Use an SPDX identifier when possible.">
              <label>License</label>
              <input type="text" value={createLicense} placeholder="MIT" onChange={(e) => setCreateLicense(e.target.value)} />
            </div>
            <div className="field" title="Optional provenance marker written to metadata.organization.source_type.">
              <label>Source type</label>
              <input type="text" value={createSourceType} placeholder="internal" onChange={(e) => setCreateSourceType(e.target.value)} />
              <span className="hint">Use internal for newly-authored skills.</span>
            </div>
          </div>
        </details>
        <span className="hint">
          Import a folder when your skill already has supporting files such as{' '}
          <span className="mono">references/</span>, <span className="mono">scripts/</span> or{' '}
          <span className="mono">assets/</span>. The selected folder must contain{' '}
          <span className="mono">SKILL.md</span>.
        </span>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={scaffold} disabled={busy}>
            {busy ? <Spinner /> : <Sparkles size={15} />} Create skill
          </button>
          <button className="btn" onClick={importFolder} disabled={busy}>
            <FolderOpen size={15} /> Import folder
          </button>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 620, marginTop: 18 }}>
        <div className="field" style={{ marginBottom: 8 }}>
          <label>Import remote skill mirror</label>
          <span className="hint">
            Fetch a GitHub skill folder, add organization mirror metadata, create{' '}
            <span className="mono">upstream.lock.yaml</span> and <span className="mono">PATCHES.md</span>,
            then review it before uploading as a PR.
          </span>
          <input
            type="text"
            value={remoteUrl}
            placeholder="https://github.com/anthropics/skills/tree/main/skills/pdf"
            onChange={(e) => setRemoteUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && importRemote()}
          />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Mirror name (optional)</label>
            <input
              type="text"
              value={remoteName}
              placeholder="anthropic-pdf"
              onChange={(e) => setRemoteName(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Internal owner</label>
            <input
              type="text"
              value={remoteOwner}
              placeholder="@your-org/your-team"
              onChange={(e) => setRemoteOwner(e.target.value)}
            />
          </div>
        </div>
        <div className="field" style={{ maxWidth: 260 }}>
          <label>Lifecycle</label>
          <select value={remoteLifecycle} onChange={(e) => setRemoteLifecycle(e.target.value)}>
            <option value="experimental">experimental</option>
            <option value="review">review</option>
            <option value="active">active</option>
            <option value="maintain">maintain</option>
            <option value="deprecated">deprecated</option>
            <option value="archived">archived</option>
          </select>
        </div>
        <span className="hint">
          Remote imports are staged as an editable mirror first. Review the generated{' '}
          <span className="mono">SKILL.md</span>, lock file and any upstream scripts before uploading
          the mirror as a pull request.
        </span>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={importRemote} disabled={busy}>
            {busy ? <Spinner /> : <CloudDownload size={15} />} Import remote
          </button>
        </div>
      </div>
    </div>
  )
}
