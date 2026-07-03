import { Pencil } from 'lucide-react'
import { useApp } from '../context'
import SkillEditor from '../components/SkillEditor'

export default function EditPage() {
  const { routeParams, navigate } = useApp()

  if (!routeParams) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>Edit a skill</h1>
            <p>Select a skill to change, then install the update locally or upload it.</p>
          </div>
        </div>
        <div className="empty">
          <Pencil className="icon" size={40} />
          <h3>Nothing selected</h3>
          <p>Pick a skill from your installed list or the repository to start editing.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => navigate('installed')}>
              Installed skills
            </button>
            <button className="btn" onClick={() => navigate('browse')}>
              Repository
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Edit “{routeParams.bundle.meta.name}”</h1>
          <p>
            {routeParams.source === 'local'
              ? 'Change the skill, then re-install locally or upload your changes.'
              : 'Editing a copy from the repository. Upload to open a pull request with your changes.'}
          </p>
        </div>
      </div>
      <SkillEditor key={routeParams.bundle.meta.name} bundle={routeParams.bundle} nameEditable={false} />
    </div>
  )
}
