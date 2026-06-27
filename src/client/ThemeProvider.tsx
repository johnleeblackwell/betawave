/**
 * ThemeProvider — injects CSS custom properties into :root from the theme
 * config, and exposes the theme object via React context so components can
 * read brand name, logo URL etc. without prop-drilling.
 */
import { createContext, useContext, useEffect } from 'react'
import { theme, Theme } from './theme.ts'

const ThemeContext = createContext<Theme>(theme)

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--brand-primary',       theme.primary)
    root.style.setProperty('--brand-primary-dark',  theme.primaryDark)
    root.style.setProperty('--brand-primary-light', theme.primaryLight)
    root.style.setProperty('--brand-primary-glow',  theme.primaryGlow)
    root.style.setProperty('--sidebar-bg',          theme.sidebarBg)
    root.style.setProperty('--sidebar-border',      theme.sidebarBorder)
    root.style.setProperty('--sidebar-active-bg',   theme.sidebarActiveBg)
    root.style.setProperty('--sidebar-text',        theme.sidebarText)
    root.style.setProperty('--sidebar-text-active', theme.sidebarTextActive)
    root.style.setProperty('--brand-font',          theme.fontFamily)
    root.style.setProperty('--brand-radius',        theme.radiusBase)
    root.style.setProperty('--brand-radius-sm',     theme.radiusSm)
    root.style.setProperty('--brand-radius-lg',     theme.radiusLg)

    // Update document title
    document.title = theme.brandName

    // Update favicon if a logo URL is provided and it ends with .ico / .png
    if (theme.logoUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.href = theme.logoUrl
    }
  }, [])

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  )
}
