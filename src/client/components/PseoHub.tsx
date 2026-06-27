import { useState } from 'react'
import { Client } from '../App.tsx'
import LocationManager from './LocationManager.tsx'
import TemplateManager from './TemplateManager.tsx'
import PseoRunner from './PseoRunner.tsx'

type SubTab = 'run' | 'locations' | 'templates'

interface Props {
  clientId: string
  client: Client
}

// pSEO hub — three sub-views grouped under the single "pSEO" tab in the Produce module.
export default function PseoHub({ clientId, client }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('run')

  return (
    <>
      <div className="sub-tabs">
        <button className={`sub-tab ${subTab === 'run' ? 'active' : ''}`} onClick={() => setSubTab('run')}>
          🚀 Run batch
        </button>
        <button className={`sub-tab ${subTab === 'locations' ? 'active' : ''}`} onClick={() => setSubTab('locations')}>
          📍 Locations
        </button>
        <button className={`sub-tab ${subTab === 'templates' ? 'active' : ''}`} onClick={() => setSubTab('templates')}>
          📝 Templates
        </button>
      </div>

      {subTab === 'run' && <PseoRunner clientId={clientId} client={client} />}
      {subTab === 'locations' && <LocationManager clientId={clientId} />}
      {subTab === 'templates' && <TemplateManager clientId={clientId} kindFilter="pseo" />}
    </>
  )
}
