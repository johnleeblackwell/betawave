/**
 * White-label theme config — driven entirely by VITE_BRAND_* env vars.
 *
 * For the default βWave deployment nothing needs to change.
 * For a white-label deployment (e.g. a multi-location brand) set these in a separate
 * .env file and build / deploy that instance independently.
 *
 * All colour values should be valid CSS colour strings (hex, rgb, hsl).
 */

export interface Theme {
  // Identity
  brandName:    string
  brandTagline: string
  logoUrl:      string | null   // if set, an <img> replaces the text logo

  // Colours — sidebar
  sidebarBg:     string
  sidebarBorder: string
  sidebarActiveBg: string
  sidebarText:   string
  sidebarTextActive: string

  // Colours — primary accent (buttons, active tabs, focus rings, client card hover)
  primary:     string   // e.g. #d97706
  primaryDark: string   // hover / pressed state
  primaryLight: string  // background tint
  primaryGlow: string   // focus box-shadow colour (rgba)

  // Typography
  fontFamily: string

  // Shape
  radiusBase: string   // e.g. "8px"
  radiusSm:   string   // e.g. "6px"
  radiusLg:   string   // e.g. "12px"

  // Behaviour
  singleClient: boolean  // hide Add Client UI — for white-label single-tenant deployments
}

function env(key: string, fallback: string): string {
  // import.meta.env is injected by Vite at build time; cast to avoid
  // TypeScript complaining when the tsconfig targets a non-Vite environment.
  const metaEnv = (typeof import.meta !== 'undefined' && (import.meta as any).env) as
    Record<string, string | undefined> | undefined
  const val = metaEnv?.[key]
  return val && val.trim() ? val.trim() : fallback
}

export const theme: Theme = {
  // ── Identity ────────────────────────────────────────────────────────────────
  brandName:    env('VITE_BRAND_NAME',    'βWave™'),
  brandTagline: env('VITE_BRAND_TAGLINE', 'The Business Operation Layer.'),
  logoUrl:      env('VITE_BRAND_LOGO_URL', '') || null,

  // ── Sidebar ─────────────────────────────────────────────────────────────────
  sidebarBg:       env('VITE_SIDEBAR_BG',        '#0f172a'),
  sidebarBorder:   env('VITE_SIDEBAR_BORDER',    '#1e293b'),
  sidebarActiveBg: env('VITE_SIDEBAR_ACTIVE_BG', '#1e3a5f'),
  sidebarText:     env('VITE_SIDEBAR_TEXT',      '#94a3b8'),
  sidebarTextActive: env('VITE_SIDEBAR_TEXT_ACTIVE', '#f8fafc'),

  // ── Primary accent ───────────────────────────────────────────────────────────
  primary:      env('VITE_BRAND_PRIMARY',       '#d97706'),
  primaryDark:  env('VITE_BRAND_PRIMARY_DARK',  '#b45309'),
  primaryLight: env('VITE_BRAND_PRIMARY_LIGHT', '#fef3c7'),
  primaryGlow:  env('VITE_BRAND_PRIMARY_GLOW',  'rgba(217,119,6,0.12)'),

  // ── Typography ───────────────────────────────────────────────────────────────
  fontFamily: env(
    'VITE_BRAND_FONT',
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  ),

  // ── Shape ────────────────────────────────────────────────────────────────────
  radiusBase: env('VITE_BRAND_RADIUS',    '8px'),
  radiusSm:   env('VITE_BRAND_RADIUS_SM', '6px'),
  radiusLg:   env('VITE_BRAND_RADIUS_LG', '12px'),

  singleClient: env('VITE_SINGLE_CLIENT', '') === 'true',
}
