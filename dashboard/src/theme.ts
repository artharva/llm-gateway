import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

/**
 * Chart colors per mode. Each mode was validated separately against its own
 * surface (lightness band, chroma, CVD separation, contrast), so dark mode is
 * its own set of steps rather than an inverted light palette.
 */
export const PALETTES = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
    surface: '#fcfcfb',
    panel: '#ffffff',
    grid: '#ecebe7',
    axis: '#52514e',
    good: '#0ca30c',
    warning: '#fab219',
    critical: '#d03b3b',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500'],
    surface: '#1a1a19',
    panel: '#222220',
    grid: '#2e2e2b',
    axis: '#c3c2b7',
    good: '#0ca30c',
    warning: '#fab219',
    critical: '#d03b3b',
  },
} as const;

export type Palette = (typeof PALETTES)[Theme];

const STORAGE_KEY = 'gateway.theme';

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // Storage can be blocked; fall back to the system setting.
  }
  return 'system';
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const [systemDark, setSystemDark] = useState(media.matches);

  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [media]);

  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    try {
      if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, [choice]);

  const theme: Theme = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  const cycle = () => setChoice(theme === 'dark' ? 'light' : 'dark');
  return { theme, palette: PALETTES[theme], cycle };
}
