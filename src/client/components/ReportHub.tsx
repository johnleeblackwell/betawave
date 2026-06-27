import { useState } from 'react'
import ReportManager from './ReportManager.tsx'
import TemplateManager from './TemplateManager.tsx'

type SubTab = 'reports' | 'templates'

interface Props { clientId: string }

// Reports hub — mirrors PseoHub shape but simpler (no locations dimension).
export default function ReportHub({ clientId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('reports')

  return (
    <>
      <div className="sub-tabs">
        <button className={`sub-tab ${subTab === 'reports' ? 'active' : ''}`} onClick={() => setSubTab('reports')}>
          📊 Reports
        </button>
        <button className={`sub-tab ${subTab === 'templates' ? 'active' : ''}`} onClick={() => setSubTab('templates')}>
          📝 Templates
        </button>
      </div>

      {subTab === 'reports' && <ReportManager clientId={clientId} />}
      {subTab === 'templates' && <TemplateManager clientId={clientId} kindFilter="report" />}
    </>
  )
}
