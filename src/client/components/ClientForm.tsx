import { useState, useEffect, useMemo } from 'react'
import { Client, ModulesEnabled, useToast } from '../App.tsx'

interface Props {
  client?: Client
  onSave: () => void
  onCancel: () => void
}

type Step = 'identity' | 'mission' | 'modules'

const DEFAULT_MODULES: ModulesEnabled = {
  produce: 1, reach: 1, respond: 1, measure: 1, affiliates: 0, shop: 0,
}

const GEOGRAPHIES = [
  { value: 'UK',     label: '🇬🇧 United Kingdom' },
  { value: 'US',     label: '🇺🇸 United States'  },
  { value: 'EU',     label: '🇪🇺 European Union' },
  { value: 'GLOBAL', label: '🌍 Global'          },
]

const TIME_ZONES = [
  'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
]

export default function ClientForm({ client, onSave, onCancel }: Props) {
  const { showToast } = useToast()
  const isEdit = !!client
  const [step, setStep] = useState<Step>('identity')
  const [saving, setSaving] = useState(false)

  const [identity, setIdentity] = useState({
    name: client?.name || '',
    business_name: client?.business_name || '',
    industry: client?.industry || '',
    primary_domain: client?.primary_domain || deriveDomain(client?.wp_url) || '',
    logo_url: client?.logo_url || '',
    contact_email: client?.contact_email || '',
    geography: client?.geography || 'UK',
    time_zone: client?.time_zone || 'Europe/London',
    location: client?.location || '',
  })

  const [mission, setMission] = useState({
    mission: client?.mission || '',
    icp: client?.icp || client?.target_audience || '',
    offerings: client?.offerings || (client?.expertise_areas?.join(', ') || ''),
    brand_voice: client?.brand_voice || (client?.tone_of_voice ? `${client.tone_of_voice} tone` : ''),
    never_say: client?.never_say || '',
    always_say: client?.always_say || '',
    style_notes: client?.style_notes || '',
  })

  const [modules, setModules] = useState<ModulesEnabled>(
    client?.modules_enabled ?? DEFAULT_MODULES
  )

  // Auto-derive logo from domain if blank
  const fallbackLogo = useMemo(() => {
    const d = identity.primary_domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=128` : ''
  }, [identity.primary_domain])

  const canAdvanceFromIdentity = identity.name.trim() && identity.business_name.trim() && identity.industry.trim()

  const submit = async () => {
    if (!canAdvanceFromIdentity) {
      showToast('Identity fields are required', 'error')
      setStep('identity')
      return
    }
    setSaving(true)
    try {
      const url = isEdit ? `/api/clients/${client!.id}` : '/api/clients'
      const method = isEdit ? 'PUT' : 'POST'
      const payload = {
        ...identity,
        ...mission,
        modules_enabled: modules,
        // If user left logo blank but we have a fallback, persist it
        logo_url: identity.logo_url || fallbackLogo,
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 422) {
        const err = await res.json().catch(() => ({ error: 'Compliance check failed' }))
        showToast(err.error || 'Compliance check failed', 'error')
        return
      }
      if (!res.ok) throw new Error('Failed to save')
      showToast(isEdit ? 'Client updated' : 'Client created — configure modules in their tabs')
      onSave()
    } catch {
      showToast('Failed to save client', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{isEdit ? `Edit ${client!.business_name}` : 'New Client'}</div>
          <div className="page-subtitle">
            {isEdit
              ? 'Update identity, mission, or module activation. Module-specific settings live in their own tabs.'
              : 'Three quick screens. Identity is required; mission and modules can be edited later.'}
          </div>
        </div>
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', gap: 8, padding: '0 24px 16px' }}>
        <Stepper
          n={1}
          label="Identity"
          active={step === 'identity'}
          done={!!canAdvanceFromIdentity && step !== 'identity'}
          onClick={() => setStep('identity')}
        />
        <Stepper
          n={2}
          label="Mission"
          active={step === 'mission'}
          done={step === 'modules'}
          disabled={!canAdvanceFromIdentity}
          onClick={() => canAdvanceFromIdentity && setStep('mission')}
        />
        <Stepper
          n={3}
          label="Modules"
          active={step === 'modules'}
          done={false}
          disabled={!canAdvanceFromIdentity}
          onClick={() => canAdvanceFromIdentity && setStep('modules')}
        />
      </div>

      <div className="page-content">
        <div className="card" style={{ maxWidth: 760 }}>
          <div className="card-body">

            {/* Step 1: Identity */}
            {step === 'identity' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <FormField label="Contact name" required>
                    <input className="form-input" value={identity.name}
                      onChange={e => setIdentity({ ...identity, name: e.target.value })} placeholder="John Smith" />
                  </FormField>
                  <FormField label="Business name" required>
                    <input className="form-input" value={identity.business_name}
                      onChange={e => setIdentity({ ...identity, business_name: e.target.value })} placeholder="Acme Co." />
                  </FormField>
                  <FormField label="Industry" required hint="e.g. SaaS · Dental Clinic · Solicitors">
                    <input className="form-input" value={identity.industry}
                      onChange={e => setIdentity({ ...identity, industry: e.target.value })} placeholder="Industry / sector" />
                  </FormField>
                  <FormField label="Primary domain" hint="Used for citation matching + logo lookup">
                    <input className="form-input" value={identity.primary_domain}
                      onChange={e => setIdentity({ ...identity, primary_domain: e.target.value })} placeholder="acme.com" />
                  </FormField>
                  <FormField label="Contact email">
                    <input className="form-input" type="email" value={identity.contact_email}
                      onChange={e => setIdentity({ ...identity, contact_email: e.target.value })} placeholder="hello@acme.com" />
                  </FormField>
                  <FormField label="Logo URL (optional)" hint={fallbackLogo ? 'Auto-derived from domain favicon. Override with your own URL.' : undefined}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {(identity.logo_url || fallbackLogo) && (
                        <img src={identity.logo_url || fallbackLogo} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'contain', background: '#f1f5f9' }} />
                      )}
                      <input className="form-input" value={identity.logo_url}
                        onChange={e => setIdentity({ ...identity, logo_url: e.target.value })} placeholder={fallbackLogo || 'https://...'} />
                    </div>
                  </FormField>
                  <FormField label="Geography" hint="Drives compliance + outbound timing defaults">
                    <select className="form-input" value={identity.geography}
                      onChange={e => setIdentity({ ...identity, geography: e.target.value })}>
                      {GEOGRAPHIES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Time zone">
                    <select className="form-input" value={identity.time_zone}
                      onChange={e => setIdentity({ ...identity, time_zone: e.target.value })}>
                      {TIME_ZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Location (optional)" hint="Manchester, UK · Málaga · UK-wide">
                    <input className="form-input" value={identity.location}
                      onChange={e => setIdentity({ ...identity, location: e.target.value })} placeholder="City or region" />
                  </FormField>
                </div>
              </>
            )}

            {/* Step 2: Mission */}
            {step === 'mission' && (
              <>
                <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: '0.85rem', color: '#475569' }}>
                  These fields drive every AI action βWave takes on this client's behalf — content prompts, citation queries, diagnostic narratives, outbound emails. Optional but worth filling in once.
                </div>

                <FormField label="Mission" hint="One sentence: what is this business trying to achieve?">
                  <input className="form-input" value={mission.mission}
                    onChange={e => setMission({ ...mission, mission: e.target.value })}
                    placeholder="Become the most-cited dental clinic in your city's AI search." />
                </FormField>

                <FormField label="Who they serve (ICP)" hint="Plain English description of the ideal customer">
                  <textarea className="form-input" rows={2} value={mission.icp}
                    onChange={e => setMission({ ...mission, icp: e.target.value })}
                    placeholder="Adults 25-45 in the local area looking for cosmetic and routine dental care. Disposable income £50k+. Discovers via Instagram, Google, and word of mouth." />
                </FormField>

                <FormField label="What they sell / do" hint="Service or product catalog, brief">
                  <textarea className="form-input" rows={2} value={mission.offerings}
                    onChange={e => setMission({ ...mission, offerings: e.target.value })}
                    placeholder="Routine check-ups; cosmetic dentistry; implants; whitening; hygiene plans." />
                </FormField>

                <FormField label="Brand voice" hint="Long-form description in their actual voice. Used by all AI generation.">
                  <textarea className="form-input" rows={3} value={mission.brand_voice}
                    onChange={e => setMission({ ...mission, brand_voice: e.target.value })}
                    placeholder="Confident, warm, slightly irreverent. Talks like a master craftsman who happens to also be your friend. Uses 'we' not 'I'. Comfortable with technical detail when it serves the customer. Avoids corporate jargon." />
                </FormField>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <FormField label="Always say">
                    <textarea className="form-input" rows={2} value={mission.always_say}
                      onChange={e => setMission({ ...mission, always_say: e.target.value })}
                      placeholder="Mention 'practice' not 'shop'. Mention 'consultation' not 'appointment' for first contact." />
                  </FormField>
                  <FormField label="Never say">
                    <textarea className="form-input" rows={2} value={mission.never_say}
                      onChange={e => setMission({ ...mission, never_say: e.target.value })}
                      placeholder="Don't mention competitors by name. Don't promise pain-free. Don't quote prices without consultation." />
                  </FormField>
                </div>

                <FormField label="Style notes (legacy free-form)">
                  <textarea className="form-input" rows={2} value={mission.style_notes}
                    onChange={e => setMission({ ...mission, style_notes: e.target.value })}
                    placeholder="Any other guardrails or signature phrases." />
                </FormField>
              </>
            )}

            {/* Step 3: Modules */}
            {step === 'modules' && (
              <>
                <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: '0.85rem', color: '#475569' }}>
                  Toggle which modules this client uses. Each module's specific settings (SMTP, WordPress, LLM provider, Stripe, etc.) live inside that module's own tab — configure them after creating the client.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <ModuleCard
                    icon="📡" name="Produce" hint="Blogs, newsletters, social posts, pSEO, reports"
                    enabled={!!modules.produce}
                    onToggle={v => setModules({ ...modules, produce: v ? 1 : 0 })}
                  />
                  <ModuleCard
                    icon="🎯" name="Reach" hint="Discovery Layer, scheduling, gift card shop"
                    enabled={!!modules.reach}
                    onToggle={v => setModules({ ...modules, reach: v ? 1 : 0 })}
                  />
                  <ModuleCard
                    icon="💬" name="Respond" hint="Comment management, conversations, reply automation"
                    enabled={!!modules.respond}
                    onToggle={v => setModules({ ...modules, respond: v ? 1 : 0 })}
                  />
                  <ModuleCard
                    icon="📊" name="Measure" hint="AI citation tracking across Anthropic / OpenAI / Perplexity / Gemini"
                    enabled={!!modules.measure}
                    onToggle={v => setModules({ ...modules, measure: v ? 1 : 0 })}
                  />
                  <ModuleCard
                    icon="🤝" name="Affiliates" hint="Lead generators with 20%/10% commissions and 6-month gate"
                    enabled={!!modules.affiliates}
                    onToggle={v => setModules({ ...modules, affiliates: v ? 1 : 0 })}
                  />
                  <ModuleCard
                    icon="🎁" name="Shop" hint="Gift cards via Stripe, public storefront, redemption"
                    enabled={!!modules.shop}
                    onToggle={v => setModules({ ...modules, shop: v ? 1 : 0 })}
                  />
                </div>

                <div style={{ marginTop: 20, padding: 12, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, fontSize: '0.82rem', color: '#92400e' }}>
                  💡 Tabs in this client's view will show only the modules you've enabled here. You can re-enable later via Edit Profile.
                </div>
              </>
            )}
          </div>

          {/* Footer nav */}
          <div className="card-footer" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: 16 }}>
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <div style={{ display: 'flex', gap: 8 }}>
              {step !== 'identity' && (
                <button className="btn btn-secondary" onClick={() => setStep(step === 'modules' ? 'mission' : 'identity')}>
                  ← Back
                </button>
              )}
              {step === 'identity' && (
                <button className="btn btn-primary" disabled={!canAdvanceFromIdentity}
                  onClick={() => setStep('mission')}>
                  Next: Mission →
                </button>
              )}
              {step === 'mission' && (
                <>
                  <button className="btn btn-ghost" onClick={() => setStep('modules')}>Skip →</button>
                  <button className="btn btn-primary" onClick={() => setStep('modules')}>Next: Modules →</button>
                </>
              )}
              {step === 'modules' && (
                <button className="btn btn-primary" onClick={submit} disabled={saving}>
                  {saving ? 'Saving…' : (isEdit ? '💾 Save changes' : '✓ Create client')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Stepper({ n, label, active, done, disabled, onClick }: {
  n: number; label: string; active: boolean; done: boolean; disabled?: boolean; onClick: () => void
}) {
  const bg = active ? '#4f46e5' : done ? '#16a34a' : disabled ? '#e2e8f0' : '#cbd5e1'
  const color = active || done ? '#fff' : '#475569'
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        border: 'none', borderRadius: 8, background: active ? '#eef2ff' : '#f8fafc',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
      }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: '50%', background: bg, color, fontSize: '0.78rem', fontWeight: 700,
      }}>
        {done ? '✓' : n}
      </span>
      <span style={{ fontWeight: active ? 600 : 500, color: active ? '#3730a3' : '#475569' }}>{label}</span>
    </button>
  )
}

function FormField({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <div className="form-group" style={{ marginBottom: 14 }}>
      <label className="form-label" style={{ display: 'block', marginBottom: 4 }}>
        {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function ModuleCard({ icon, name, hint, enabled, onToggle }: {
  icon: string; name: string; hint: string; enabled: boolean; onToggle: (v: boolean) => void
}) {
  return (
    <div
      onClick={() => onToggle(!enabled)}
      style={{
        padding: 14, borderRadius: 10,
        border: `2px solid ${enabled ? '#4f46e5' : '#e2e8f0'}`,
        background: enabled ? '#eef2ff' : '#fff',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: '1.4rem' }}>{icon}</div>
        <Toggle enabled={enabled} onChange={onToggle} />
      </div>
      <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>{name}</div>
      <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>{hint}</div>
    </div>
  )
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(!enabled) }}
      style={{
        width: 36, height: 20, borderRadius: 10,
        background: enabled ? '#4f46e5' : '#cbd5e1',
        border: 'none', position: 'relative', cursor: 'pointer', padding: 0,
        transition: 'background 0.15s',
      }}>
      <span style={{
        position: 'absolute', top: 2, left: enabled ? 18 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
      }} />
    </button>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function deriveDomain(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
