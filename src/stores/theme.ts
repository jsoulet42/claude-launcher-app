import { create } from 'zustand';

export type ThemeName = 'dark' | 'light' | 'custom';

export interface CustomThemeColors {
  bg_primary: string;
  bg_secondary: string;
  bg_surface: string;
  text_primary: string;
  accent: string;
}

interface ThemeState {
  theme: ThemeName;
  previousTheme: ThemeName;
  customColors: CustomThemeColors | null;
  applyTheme: (theme: ThemeName, customColors?: CustomThemeColors | null) => void;
  revertTheme: () => void;
  commitTheme: () => void;
}

// --- Color manipulation helpers (hex <-> HSL) ---

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  l = clamp(l);
  s = clamp(s);

  if (s === 0) {
    const v = Math.round(l * 255);
    return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function adjustLightness(hex: string, delta: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, l + delta);
}

// --- Derive secondary colors from 5 custom colors ---

function deriveCustomVariables(colors: CustomThemeColors): Record<string, string> {
  const [, , bgL] = hexToHsl(colors.bg_primary);
  const isDark = bgL < 0.5;
  const shadowOpacity = isDark ? 0.3 : 0.08;

  return {
    '--bg-primary': colors.bg_primary,
    '--bg-secondary': colors.bg_secondary,
    '--bg-surface': colors.bg_surface,
    '--text-primary': colors.text_primary,
    '--text-secondary': adjustLightness(colors.text_primary, isDark ? -0.15 : 0.15),
    '--text-muted': adjustLightness(colors.text_primary, isDark ? -0.30 : 0.30),
    '--accent': colors.accent,
    // Keep status colors from dark theme
    '--accent-green': '#a6e3a1',
    '--accent-red': '#f38ba8',
    '--accent-yellow': '#f9e2af',
    '--bg-titlebar': adjustLightness(colors.bg_secondary, isDark ? -0.03 : -0.03),
    '--bg-sidebar': colors.bg_secondary,
    '--bg-statusbar': colors.bg_secondary,
    '--bg-terminal': colors.bg_primary,
    '--bg-tab-active': colors.bg_surface,
    '--bg-tab-inactive': colors.bg_primary,
    '--bg-hover': adjustLightness(colors.bg_surface, isDark ? 0.05 : -0.05),
    '--bg-selected': adjustLightness(colors.bg_surface, isDark ? 0.10 : -0.10),
    '--border-primary': colors.bg_surface,
    '--border-subtle': adjustLightness(colors.bg_surface, isDark ? 0.05 : -0.05),
    '--border-accent': colors.accent,
    '--shadow-sm': `0 1px 2px rgba(0, 0, 0, ${shadowOpacity})`,
    '--shadow-md': `0 4px 8px rgba(0, 0, 0, ${shadowOpacity * 1.3})`,
    '--shadow-lg': `0 8px 16px rgba(0, 0, 0, ${shadowOpacity * 1.7})`,
    '--shadow-card': `0 1px 3px rgba(0, 0, 0, ${shadowOpacity * 0.7})`,
  };
}

// --- Store ---

function applyThemeToDOM(theme: ThemeName, customColors?: CustomThemeColors | null) {
  const root = document.documentElement;

  // Clear custom properties if switching away from custom
  if (theme !== 'custom') {
    root.removeAttribute('style');
  }

  if (theme === 'custom' && customColors) {
    root.setAttribute('data-theme', 'custom');
    const vars = deriveCustomVariables(customColors);
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
  } else if (theme === 'custom' && !customColors) {
    // Fallback: custom without colors → dark
    root.setAttribute('data-theme', 'dark');
  } else {
    root.setAttribute('data-theme', theme);
  }

  // Dispatch event for xterm.js theme sync
  document.dispatchEvent(new CustomEvent('theme-changed'));
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'dark',
  previousTheme: 'dark',
  customColors: null,

  applyTheme: (theme, customColors) => {
    const current = get();
    set({
      theme,
      previousTheme: current.theme,
      customColors: customColors ?? current.customColors,
    });
    applyThemeToDOM(theme, customColors ?? current.customColors);
  },

  revertTheme: () => {
    const { previousTheme, customColors } = get();
    set({ theme: previousTheme });
    applyThemeToDOM(previousTheme, previousTheme === 'custom' ? customColors : null);
  },

  commitTheme: () => {
    const { theme } = get();
    set({ previousTheme: theme });
  },
}));
