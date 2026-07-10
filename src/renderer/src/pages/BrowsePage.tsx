import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Download, Package, Settings as SettingsIcon, Pencil } from 'lucide-react'
import type { LocalSkill, RepoSkill, RepoDoctorReport } from '@shared/types'
import { api, unwrap } from '../api'
import { useApp } from '../context'
import { Loading, Spinner } from '../components/Spinner'
import Modal from '../components/Modal'
import TargetPicker from '../components/TargetPicker'
import {
  buildInstallMap,
  filterRepoSkills,
  isRemoteSkill,
  ownerOptions,
  type CatalogFilters,
  type InstallFilter,
  type SourceFilter
} from '../lib/skillFilters'

export default function BrowsePage() {
  const { configured, clients, toast, navigate } = useApp()
  const [skills, setSkills] = useState<RepoSkill[] | null>(null)
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([])
  const [health, setHealth] = useState<RepoDoctorReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<CatalogFilters>({
    owner: '',
    source: 'all',
    install: 'all',
    updatableOnly: false
  })

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
      try {
        setLocalSkills(await unwrap(configured ? api.local.checkUpdates() : api.local.list()))
      } catch {
        setLocalSkills([])
      }
    } catch (err) {
      setError((err as Error).message)
      setSkills(null)
      setLocalSkills([])
      setHealth(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured])

  const installMap = useMemo(
    () => buildInstallMap(skills ?? [], localSkills),
    [skills, localSkills]
  )
  const visibleSkills = useMemo(
    () => filterRepoSkills(skills ?? [], installMap, filters),
    [skills, installMap, filters]
  )
  const owners = useMemo(() => ownerOptions(skills ?? []), [skills])
  const installedCount = Object.values(installMap).filter((item) => item.installed).length
  const updatableCount = Object.values(installMap).filter((item) => item.updatable).length

  function setFilter<K extends keyof CatalogFilters>(key: K, value: CatalogFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

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
              {health.counts.skills} skills · {health.counts.claudeMarketplace} Claude marketplace · {health.counts.copilotMarketplace} Copilot marketplace · {health.counts.skillsHub} Skills Hub · {health.counts.triggerEvals} trigger evals · {health.mode} mode
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
        <div className="filter-bar">
          <div className="filter-field">
            <label>Owner</label>
            <select value={filters.owner} onChange={(event) => setFilter('owner', event.target.value)}>
              <option value="">All owners</option>
              {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label>Source</label>
            <select value={filters.source} onChange={(event) => setFilter('source', event.target.value as SourceFilter)}>
              <option value="all">All sources</option>
              <option value="own">Our skills</option>
              <option value="remote">Remote mirrors</option>
            </select>
          </div>
          <div className="filter-field">
            <label>Install state</label>
            <select value={filters.install} onChange={(event) => setFilter('install', event.target.value as InstallFilter)}>
              <option value="all">All install states</option>
              <option value="installed">Installed ({installedCount})</option>
              <option value="not-installed">Not installed</option>
            </select>
          </div>
          <label className="checkbox-filter">
            <input
              type="checkbox"
              checked={filters.updatableOnly}
              onChange={(event) => setFilter('updatableOnly', event.target.checked)}
            />
            Updatable ({updatableCount})
          </label>
          <span className="filter-count">Showing {visibleSkills.length} of {skills.length}</span>
        </div>
      )}

      {skills && skills.length > 0 && visibleSkills.length === 0 && (
        <div className="empty compact-empty">
          <h3>No skills match these filters</h3>
          <p>Relax one of the filters to see more skills.</p>
        </div>
      )}

      {skills && visibleSkills.length > 0 && (
        <div className="grid">
          {visibleSkills.map((s) => {
            const bundled = s.repoPath.startsWith('builtin/')
            const install = installMap[s.repoPath] ?? { installed: false, updatable: false }
            return (
              <div
                className="card clickable-card"
                key={s.repoPath}
                role="button"
                tabIndex={0}
                onClick={() => editSkill(s)}
                onKeyDown={(event) => {
                  if (event.key === ' ') event.preventDefault()
                  if (event.key === 'Enter' || event.key === ' ') editSkill(s)
                }}
              >
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
                  {s.owner && <span className="badge gray">owner: {s.owner}</span>}
                  <span className={isRemoteSkill(s) ? 'badge amber' : 'badge green'}>
                    {isRemoteSkill(s) ? 'remote mirror' : 'our skill'}
                  </span>
                  {install.installed ? <span className="badge green">installed</span> : <span className="badge gray">not installed</span>}
                  {install.updatable && <span className="badge amber">update available</span>}
                  {s.marketplaces?.claude === true && <span className="badge green">Claude marketplace</span>}
                  {s.marketplaces?.claude === false && <span className="badge amber">missing Claude</span>}
                  {s.marketplaces?.copilot === true && <span className="badge green">Copilot marketplace</span>}
                  {s.marketplaces?.copilot === false && <span className="badge amber">missing Copilot</span>}
                  {s.skillsHub?.group && <span className="badge green">Skills Hub: {s.skillsHub.group}</span>}
                  {s.skillsHub && !s.skillsHub.group && <span className="badge amber">missing Skills Hub</span>}
                  {s.evals?.triggersPath && <span className="badge accent">trigger evals</span>}
                  {s.evals && !s.evals.triggersPath && <span className="badge amber">missing evals</span>}
                  {s.install?.hermes && <span className="mono">Hermes: {s.install.hermes}</span>}
                  <span className="mono">{s.repoPath}</span>
                </div>
                <div
                  className="card-actions"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
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
