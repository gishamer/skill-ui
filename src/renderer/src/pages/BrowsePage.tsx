import { useEffect, useState } from 'react'
import { RefreshCw, Download, Package, Settings as SettingsIcon, Pencil } from 'lucide-react'
import type { RepoSkill, RepoDoctorReport } from '@shared/types'
import { api, unwrap } from '../api'
import { useApp } from '../context'
import { Loading, Spinner } from '../components/Spinner'
import Modal from '../components/Modal'
import TargetPicker from '../components/TargetPicker'

export default function BrowsePage() {
  const { configured, clients, toast, navigate } = useApp()
  const [skills, setSkills] = useState<RepoSkill[] | null>(null)
  const [health, setHealth] = useState<RepoDoctorReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [installTarget, setInstallTarget] = useState<RepoSkill | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [nextSkills, nextHealth] = await Promise.all([
        unwrap(api.repo.list()),
        unwrap(api.repo.doctor())
      ])
      setSkills(nextSkills)
      setHealth(nextHealth)
    } catch (err) {
      setError((err as Error).message)
      setSkills(null)
      setHealth(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured])

  function openInstall(skill: RepoSkill) {
    setSelected(clients.filter((c) => c.exists).map((c) => c.path))
    setInstallTarget(skill)
  }

  async function doInstall() {
    if (!installTarget) return
    if (selected.length === 0)
      return toast({ kind: 'error', message: 'Select at least one target directory.' })
    setBusy(true)
    try {
      const res = await unwrap(
        api.skills.install({ repoPath: installTarget.repoPath, targetDirs: selected })
      )
      toast({
        kind: 'success',
        message: `Installed “${installTarget.name}” to ${res.installed.length} location${res.installed.length === 1 ? '' : 's'}.`
      })
      setInstallTarget(null)
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function editSkill(skill: RepoSkill) {
    try {
      const bundle = await unwrap(api.repo.read(skill.repoPath))
      navigate('edit', { bundle, source: 'repo' })
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Skill repository</h1>
          <p>Browse bundled and repository skills published to your organisation and install them with one click.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw size={15} />} Refresh
          </button>
        </div>
      </div>

      {!configured && (
        <div className="banner warn">
          <SettingsIcon size={18} color="var(--amber)" />
          <div className="banner-text">
            <strong>Connect your skill repository</strong>
            <span>Set a GitHub repository with a token, or point Skill UI at a local checkout.</span>
          </div>
          <button className="btn" onClick={() => navigate('settings')}>
            Open Settings
          </button>
        </div>
      )}

      {loading && <Loading label="Loading skills…" />}

      {health && (
        <div className={`banner ${health.ok ? 'success' : 'warn'}`}>
          <Package size={18} color={health.ok ? 'var(--green)' : 'var(--amber)'} />
          <div className="banner-text">
            <strong>Repo health: {health.ok ? 'OK' : `${health.issues.filter((i) => i.severity === 'error').length} issue(s)`}</strong>
            <span>
              {health.counts.skills} skills · {health.counts.claudeMarketplace} Claude marketplace · {health.counts.copilotMarketplace} Copilot marketplace · {health.counts.triggerEvals} trigger evals · {health.mode} mode
            </span>
            {!health.ok && health.issues.slice(0, 3).map((issue) => (
              <span key={`${issue.code}-${issue.name ?? issue.message}`} className="mono">{issue.code}: {issue.name ?? issue.message}</span>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="empty">
          <h3>Couldn’t load skills</h3>
          <p>{error}</p>
          <button className="btn" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {!loading && !error && skills && skills.length === 0 && (
        <div className="empty">
          <Package className="icon" size={40} />
          <h3>No skills yet</h3>
          <p>No bundled or repository skills are available yet. Create one and upload it to get started.</p>
          <button className="btn primary" onClick={() => navigate('create')}>
            Create a skill
          </button>
        </div>
      )}

      {skills && skills.length > 0 && (
        <div className="grid">
          {skills.map((s) => {
            const bundled = s.repoPath.startsWith('builtin/')
            return (
              <div className="card" key={s.repoPath}>
                <div className="card-title">
                  <Package size={16} color="var(--accent)" />
                  {s.name}
                </div>
                <div className="card-desc">{s.description || 'No description provided.'}</div>
                <div className="card-meta">
                  {s.version ? (
                    <span className="badge accent">v{s.version}</span>
                  ) : (
                    <span className="badge gray">unversioned</span>
                  )}
                  {s.marketplaces?.claude === true && <span className="badge green">Claude marketplace</span>}
                  {s.marketplaces?.claude === false && <span className="badge amber">missing Claude</span>}
                  {s.marketplaces?.copilot === true && <span className="badge green">Copilot marketplace</span>}
                  {s.marketplaces?.copilot === false && <span className="badge amber">missing Copilot</span>}
                  {s.evals?.triggersPath && <span className="badge accent">trigger evals</span>}
                  {s.evals && !s.evals.triggersPath && <span className="badge amber">missing evals</span>}
                  <span className="mono">{s.repoPath}</span>
                </div>
                <div className="card-actions">
                  <button className="btn primary small" onClick={() => openInstall(s)}>
                    <Download size={14} /> Install
                  </button>
                  {!bundled && (
                    <button className="btn small" onClick={() => editSkill(s)}>
                      <Pencil size={14} /> Edit
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {installTarget && (
        <Modal
          title={`Install “${installTarget.name}”`}
          subtitle="Choose which client directories to install this skill into."
          onClose={() => !busy && setInstallTarget(null)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setInstallTarget(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn primary" onClick={doInstall} disabled={busy}>
                {busy ? <Spinner /> : <Download size={15} />} Install
              </button>
            </>
          }
        >
          <TargetPicker clients={clients} selected={selected} onChange={setSelected} />
        </Modal>
      )}
    </div>
  )
}
