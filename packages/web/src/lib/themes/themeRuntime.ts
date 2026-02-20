import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getThemeById,
  THEME_STORAGE_KEY,
  THEMES,
} from "./themePresets";
import type { ThemeDefinition, ThemeMode, ThemeUiPalette } from "./types";

function normalizeHex(hex: string): string {
  const trimmed = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  throw new Error(`Invalid hex color: ${hex}`);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex);
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
}

function rgbToHslChannels({ r, g, b }: { r: number; g: number; b: number }): string {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta) % 6;
    } else if (max === gNorm) {
      h = (bNorm - rNorm) / delta + 2;
    } else {
      h = (rNorm - gNorm) / delta + 4;
    }
  }

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  const sPct = Math.round(s * 100);
  const lPct = Math.round(l * 100);
  return `${h} ${sPct}% ${lPct}%`;
}

function hexToHslChannels(hex: string): string {
  return rgbToHslChannels(hexToRgb(hex));
}

const UI_VAR_MAP: Record<keyof ThemeUiPalette, `--${string}`> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
};

function setColorScheme(mode: ThemeMode): void {
  document.documentElement.style.colorScheme = mode;
}

function setMetaThemeColor(color: string): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta instanceof HTMLMetaElement) {
    meta.content = color;
  }
}

export function applyThemeToDocument(theme: ThemeDefinition): void {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.classList.toggle("dark", theme.mode === "dark");

  for (const [paletteKey, cssVarName] of Object.entries(UI_VAR_MAP)) {
    const key = paletteKey as keyof ThemeUiPalette;
    root.style.setProperty(cssVarName, hexToHslChannels(theme.ui[key]));
  }

  setColorScheme(theme.mode);
  setMetaThemeColor(theme.themeColor);
}

function preferredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveLegacyThemeId(): string | undefined {
  const legacyTheme = localStorage.getItem("theme");
  if (legacyTheme === "dark") return DEFAULT_DARK_THEME_ID;
  if (legacyTheme === "light") return DEFAULT_LIGHT_THEME_ID;
  return undefined;
}

export function resolveInitialTheme(): ThemeDefinition {
  const storedThemeId = localStorage.getItem(THEME_STORAGE_KEY);
  const storedTheme = getThemeById(storedThemeId);
  if (storedTheme) return storedTheme;

  const legacyThemeId = resolveLegacyThemeId();
  const legacyTheme = getThemeById(legacyThemeId);
  if (legacyTheme) return legacyTheme;

  const mode = preferredThemeMode();
  const defaultThemeId = mode === "dark" ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
  return getThemeById(defaultThemeId) ?? THEMES[0];
}

export function persistThemeSelection(themeId: string): void {
  localStorage.setItem(THEME_STORAGE_KEY, themeId);
}
