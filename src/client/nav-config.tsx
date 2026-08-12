/**
 * Navigation config — the single source of truth for the Four Pillars and the
 * tools under each. Both the sidebar accordion (App.tsx) and the client content
 * area (ClientView.tsx) import from here, so the two can never disagree about
 * which tools exist or which are visible for a given client.
 *
 * The gating rules (per-client module toggles + operator restrictions) live
 * here too — moved verbatim from ClientView so the accordion respects them
 * exactly. Getting these wrong is silent (a client sees a tool they shouldn't,
 * or loses one they should have), so they have one home.
 */

export type Tab =
  | 'overview' | 'sources' | 'content' | 'generate' | 'social' | 'reports'
  | 'schedule' | 'respond' | 'citation' | 'shop' | 'discovery' | 'syndicate' | 'site' | 'gsc'

export type Module = 'profile' | 'produce' | 'reach' | 'respond' | 'measure'

export const TAB_META: Record<Tab, { label: string; icon: string; module: Module; disabled?: boolean }> = {
  overview: { label: 'Overview',  icon: '👤', module: 'profile' },
  sources:  { label: 'Sources',   icon: '📡', module: 'produce' },
  generate: { label: 'Generate',  icon: '⚡', module: 'produce' },
  social:   { label: 'Social',    icon: '📱', module: 'produce' },
  syndicate:{ label: 'Syndicate', icon: '🔀', module: 'produce' },
  reports:  { label: 'Reports',   icon: '📊', module: 'produce' },
  content:  { label: 'Content',   icon: '📚', module: 'produce' },
  shop:     { label: 'Shop',      icon: '🎁', module: 'reach'   },
  schedule: { label: 'Schedule',  icon: '🗓️', module: 'reach'   },
  discovery:{ label: 'Discovery', icon: '🎯', module: 'reach'   },
  site:     { label: 'Site',      icon: '🌐', module: 'reach'   },
  respond:  { label: 'Respond',   icon: '💬', module: 'respond' },
  citation: { label: 'Citations', icon: '📡', module: 'measure' },
  gsc:      { label: 'Search Console', icon: '🔍', module: 'measure' },
}

// Order tools appear within their pillar.
export const TAB_ORDER: Tab[] = [
  'overview',
  'sources', 'generate', 'social', 'syndicate', 'reports', 'content',
  'site', 'shop', 'discovery', 'schedule',
  'respond',
  'citation', 'gsc',
]

// Owner/agency-only tabs — never shown to a client OPERATOR. Discovery is the
// B2B prospecting funnel, not a client marketing tool, so Andy at a client
// account has no business seeing it.
//
// A DEMO user is not an operator in this respect even though it shares the
// scoping: they are a prospect being shown the product, and Reach is the most
// persuasive part of it. Passing the same flag for both meant the demo login
// opened on Produce with the pipeline hidden — the strongest thing in the app,
// invisible to precisely the audience the login exists for.
export const OPERATOR_HIDDEN_TABS: Tab[] = ['discovery']

// The four pillars, in display order, with their dot colour class + subtitle.
export const PILLARS: { module: Exclude<Module, 'profile'>; label: string; sub: string }[] = [
  { module: 'produce', label: 'Produce', sub: 'create' },
  { module: 'reach',   label: 'Reach',   sub: 'distribute' },
  { module: 'respond', label: 'Respond', sub: 'engage' },
  { module: 'measure', label: 'Measure', sub: 'citations' },
]

// Map a pillar to its key in clients.modules_enabled.
const MODULE_KEY: Record<Exclude<Module, 'profile'>, 'produce' | 'reach' | 'respond' | 'measure'> = {
  produce: 'produce', reach: 'reach', respond: 'respond', measure: 'measure',
}

/** Loose shape of clients.modules_enabled — values are 0/1 or booleans. */
export type ModulesEnabled = Partial<Record<'produce' | 'reach' | 'respond' | 'measure' | 'shop' | 'affiliates', unknown>> | null | undefined

/** Which tools this client+role should see, in TAB_ORDER. Verbatim from the
 *  old ClientView logic so behaviour is unchanged. */
export function computeVisibleTabs(modules: ModulesEnabled, operator: boolean): Tab[] {
  return TAB_ORDER.filter(t => {
    if (operator && OPERATOR_HIDDEN_TABS.includes(t)) return false
    const meta = TAB_META[t]
    if (meta.module === 'profile') return true
    // Shop needs its own module flag, not the umbrella 'reach' toggle.
    if (t === 'shop') return modules ? !!(modules as any).shop : true
    const key = MODULE_KEY[meta.module as Exclude<Module, 'profile'>]
    return modules ? !!(modules as any)[key] : true
  })
}

/** Group visible tools under their pillar, dropping empty pillars. Drives the
 *  sidebar accordion. `overview` (profile) is handled separately by the caller. */
export function pillarGroups(modules: ModulesEnabled, operator: boolean) {
  const visible = new Set(computeVisibleTabs(modules, operator))
  return PILLARS
    .map(p => ({
      ...p,
      tools: TAB_ORDER.filter(t => visible.has(t) && TAB_META[t].module === p.module),
    }))
    .filter(p => p.tools.length > 0)
}

/** Every pillar with all its tools, ungated — for the dashboard-level preview
 *  accordion, where there's no client to gate against. Shows the full shape of
 *  each pillar so the hierarchy is visible before you open a client. */
export function allPillarGroups() {
  return PILLARS.map(p => ({
    ...p,
    tools: TAB_ORDER.filter(t => TAB_META[t].module === p.module),
  }))
}

/** Breadcrumb helper: the pillar a tab belongs to (null for overview). */
export function pillarFor(tab: Tab) {
  const mod = TAB_META[tab].module
  return PILLARS.find(p => p.module === mod) ?? null
}
