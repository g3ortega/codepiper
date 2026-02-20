import type { ITheme } from "xterm";

export type ThemeMode = "light" | "dark";

export interface ThemeUiPalette {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
}

export interface ThemeDefinition {
  id: string;
  label: string;
  description: string;
  mode: ThemeMode;
  themeColor: string;
  monacoTheme: "vs" | "vs-dark";
  ui: ThemeUiPalette;
  terminal: ITheme;
}
