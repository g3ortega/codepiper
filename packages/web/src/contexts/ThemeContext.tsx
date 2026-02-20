import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applyThemeToDocument,
  getThemeById,
  persistThemeSelection,
  resolveInitialTheme,
  THEMES,
  type ThemeDefinition,
} from "@/lib/themes";

interface ThemeState {
  theme: ThemeDefinition;
  themes: readonly ThemeDefinition[];
  setTheme: (themeId: string) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeDefinition>(() => resolveInitialTheme());

  useEffect(() => {
    applyThemeToDocument(theme);
    persistThemeSelection(theme.id);
  }, [theme]);

  const setTheme = useCallback((themeId: string) => {
    const nextTheme = getThemeById(themeId);
    if (nextTheme) {
      setThemeState(nextTheme);
    }
  }, []);

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      themes: THEMES,
      setTheme,
    }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
