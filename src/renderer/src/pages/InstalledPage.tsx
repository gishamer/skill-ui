import { useEffect, useState } from 'react'
import {
  RefreshCw,
  ArrowUpCircle,
  FolderOpen,
  Pencil,
  HardDrive,
  Settings as SettingsIcon
} from 'lucide-react'
import type { LocalSkill, UpdateReport } from '@shared/types'
import { api, unwrap } from '../api'
import { useApp } from '../context'
import { Loading, Spinner } from '../components/Spinner'

export default function InstalledPage() {
  const { clients, configured, toast, navigate } = useApp()
  const [skills, setSkills] = useState<LocalSkill[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [updatingDir, setUpdatingDir] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      // When configured, annotate with update status; otherwise just list.
      setSkills(await unwrap(configured ? api.local.checkUpdates() : api.local.list()))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured])

  function reportToast(report: UpdateReport) {
    if (report.updated.length === 0) {
      toast({ kind: 'info', message: 'Everything is already up to date.' })
    } else {
      toast({
        kind: 'success',
        message: `Updated ${report.updated.length} skill${report.updated.length === 1 ? '' : 's'}.`
      })
    }
  }

  async function updateAll() {
    setUpdatingAll(true)
    try {
      reportToast(await unwrap(api.skills.update({})))
      await load()
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setUpdatingAll(false)
    }
  }

  async function updateOne(skill: LocalSkill) {
    setUpdatingDir(skill.dir)
    try {
      const report = await unwrap(
        api.skills.update({ targets: [{ clientId: skill.clientId, dir: skill.dir }] })
      )
      if (report.updated.length > 0) {
        toast({ kind: 'success', message: `Updated “${skill.name}”.` })
      } else {
        const reason = report.skipped[0]?.reason ?? 'No update available.'
        toast({ kind: 'info', message: reason })
      }
      await load()
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setUpdatingDir(null)
    }
  }

  async function edit(skill: LocalSkill) {
    try {
      const bundle = await unwrap(api.local.read(skill.dir))
      navigate('edit', { bundle, source: 'local', dir: skill.dir })
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    }
  }

  const outdatedCount = skills?.filter((s) => s.update?.state === 'outdated').length ?? 0

  function clientLabel(id: string): string {
    return clients.find((c) => c.id === id)?.label ?? id
  }

  function statusBadge(skill: LocalSkill) {
    const st = skill.update?.state
    if (st === 'outdated')
      return (
        <span className="badge amber">
          <span className="dot" /> update available
        </span>
      )
    if (st === 'up-to-date')
      return (
        <span className="badge green">
          <span className="dot" /> up to date
        </span>
      )
    if (st === 'not-in-repo') return <span className="badge gray">not in repo</span>
    return null
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Installed skills</h1>
          <p>Skills installed across your desktop clients. Update them to the latest published version.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw size={15} />} Refresh
          </button>
          <button
            className="btn primary"
            onClick={updateAll}
            disabled={updatingAll || !configured || outdatedCount === 0}
          >
            {updatingAll ? <Spinner /> : <ArrowUpCircle size={15} />}
            Update all{outdatedCount > 0 ? ` (${outdatedCount})` : ''}
          </button>
        </div>
      </div>

      {!configured && (
        <div className="banner warn">
          <SettingsIcon size={18} color="var(--amber)" />
          <div className="banner-text">
            <strong>Repository not configured</strong>
            <span>Connect the skill repository in Settings to check for updates.</span>
          </div>
          <button className="btn" onClick={() => navigate('settings')}>
            Open Settings
          </button>
        </div>
      )}

      {loading && <Loading label="Scanning client directories…" />}

      {error && !loading && (
        <div className="empty">
          <h3>Couldn’t load installed skills</h3>
          <p>{error}</p>
          <button className="btn" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {!loading && !error && skills && skills.length === 0 && (
        <div className="empty">
          <HardDrive className="icon" size={40} />
          <h3>No skills installed</h3>
          <p>Install a skill from the repository, or create your own.</p>
          <button className="btn primary" onClick={() => navigate('browse')}>
            Browse repository
          </button>
        </div>
      )}

      {!loading && skills && skills.length > 0 && (
        <div className="list">
          {skills.map((s) => (
            <div className="list-row" key={s.dir}>
              <HardDrive size={18} color="var(--text-faint)" />
              <div className="grow">
                <div className="name">
                  {s.name}{' '}
                  {s.version && <span className="badge gray">v{s.version}</span>}
                </div>
                <div className="sub">
                  {clientLabel(s.clientId)} · <span className="mono">{s.dir}</span>
                </div>
              </div>
              {statusBadge(s)}
              <button
                className="btn small"
                onClick={() => updateOne(s)}
                disabled={updatingDir === s.dir || s.update?.state !== 'outdated'}
                title={s.update?.state === 'outdated' ? 'Update to latest' : 'Up to date'}
              >
                {updatingDir === s.dir ? <Spinner /> : <ArrowUpCircle size={14} />} Update
              </button>
              <button className="btn small" onClick={() => edit(s)}>
                <Pencil size={14} /> Edit
              </button>
              <button className="btn ghost small" onClick={() => api.local.openDir(s.dir)} title="Open folder">
                <FolderOpen size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
