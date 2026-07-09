import { useEffect, useState } from 'react'
import { Save, PlugZap, FolderOpen, CheckCircle2, KeyRound } from 'lucide-react'
import { api, unwrap } from '../api'
import { useApp } from '../context'
import { Spinner } from '../components/Spinner'

export default function SettingsPage() {
  const { settings, refreshSettings, refreshClients, toast } = useApp()

  const [repoOwner, setRepoOwner] = useState(settings.repoOwner)
  const [repoName, setRepoName] = useState(settings.repoName)
  const [repoBranch, setRepoBranch] = useState(settings.repoBranch)
  const [repoSkillsPath, setRepoSkillsPath] = useState(settings.repoSkillsPath)
  const [repoDir, setRepoDir] = useState(settings.repoDir)
  const [customSkillsDir, setCustomSkillsDir] = useState(settings.customSkillsDir)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    setRepoOwner(settings.repoOwner)
    setRepoName(settings.repoName)
    setRepoBranch(settings.repoBranch)
    setRepoSkillsPath(settings.repoSkillsPath)
    setRepoDir(settings.repoDir)
    setCustomSkillsDir(settings.customSkillsDir)
  }, [settings])

  function settingsPatch(): Parameters<typeof api.settings.set>[0] {
    const patch: Parameters<typeof api.settings.set>[0] = {
      repoOwner: repoOwner.trim(),
      repoName: repoName.trim(),
      repoBranch: repoBranch.trim() || 'main',
      repoSkillsPath: repoSkillsPath.trim(),
      repoDir: repoDir.trim(),
      customSkillsDir: customSkillsDir.trim()
    }
    if (token) patch.token = token
    return patch
  }

  async function save() {
    setSaving(true)
    try {
      await api.settings.set(settingsPatch())
      setToken('')
      await Promise.all([refreshSettings(), refreshClients()])
      toast({ kind: 'success', message: 'Settings saved.' })
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    try {
      // Persist current values first so the test uses them.
      await api.settings.set(settingsPatch())
      setToken('')
      await refreshSettings()
      const res = await unwrap(api.settings.testConnection())
      toast({ kind: 'success', message: res.login.startsWith('local:') ? `Local checkout available at ${res.login.slice('local:'.length)}.` : `Connected to GitHub as @${res.login}.` })
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  async function pickRepoDir() {
    const dir = await api.clients.pickDirectory()
    if (dir) setRepoDir(dir)
  }

  function useOrgRepoPreset() {
    setRepoOwner('your-org')
    setRepoName('skills')
    setRepoBranch('main')
    setRepoSkillsPath('skills')
  }

  async function pickCustomDir() {
    const dir = await api.clients.pickDirectory()
    if (dir) setCustomSkillsDir(dir)
  }

  async function removeToken() {
    await api.settings.set({ token: '' })
    await refreshSettings()
    toast({ kind: 'info', message: 'GitHub token removed.' })
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Connect your organisation’s skill repository and configure where skills install.</p>
        </div>
      </div>

      <div className="section-title">Skill repository</div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={useOrgRepoPreset}>
          Use generic skills repo preset
        </button>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Owner</label>
          <input type="text" value={repoOwner} onChange={(e) => setRepoOwner(e.target.value)} placeholder="owner-or-org" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Repository</label>
          <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="skills" />
        </div>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Branch</label>
          <input type="text" value={repoBranch} onChange={(e) => setRepoBranch(e.target.value)} placeholder="main" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Skills path</label>
          <span className="hint">Folder inside the repo (leave blank for the repo root).</span>
          <input
            type="text"
            value={repoSkillsPath}
            onChange={(e) => setRepoSkillsPath(e.target.value)}
            placeholder="skills"
          />
        </div>
      </div>

      <div className="section-title">Local checkout mode</div>
      <div className="field">
        <span className="hint">
          Optional. Use a local checkout as the repository source for fast/offline browsing and install tests. Uploads still use GitHub.
        </span>
        <div className="row">
          <input
            type="text"
            value={repoDir}
            onChange={(e) => setRepoDir(e.target.value)}
            placeholder="/path/to/skills-checkout"
          />
          <button className="btn" onClick={pickRepoDir}>
            <FolderOpen size={15} /> Browse
          </button>
        </div>
      </div>

      <div className="section-title">
        <KeyRound size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
        GitHub access token
      </div>
      <div className="field">
        <span className="hint">
          A personal access token with <span className="mono">repo</span> scope. Stored encrypted on
          this machine and used to read skills and open pull requests.
          {settings.hasToken && (
            <span className="badge green" style={{ marginLeft: 8 }}>
              <CheckCircle2 size={12} /> token stored
            </span>
          )}
        </span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={settings.hasToken ? '•••••••••• (leave blank to keep)' : 'ghp_…'}
        />
        {settings.hasToken && (
          <a className="link" style={{ fontSize: 12, marginTop: 4 }} onClick={removeToken}>
            Remove stored token
          </a>
        )}
      </div>

      <div className="section-title">Custom skills directory</div>
      <div className="field">
        <span className="hint">
          Optional. Adds an extra install target alongside Claude Desktop and Hermes.
        </span>
        <div className="row">
          <input
            type="text"
            value={customSkillsDir}
            onChange={(e) => setCustomSkillsDir(e.target.value)}
            placeholder="/path/to/skills"
          />
          <button className="btn" onClick={pickCustomDir}>
            <FolderOpen size={15} /> Browse
          </button>
        </div>
      </div>

      <div className="divider" />
      <div className="row">
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <Save size={15} />} Save settings
        </button>
        <button className="btn" onClick={test} disabled={testing}>
          {testing ? <Spinner /> : <PlugZap size={15} />} Test connection
        </button>
      </div>
    </div>
  )
}
