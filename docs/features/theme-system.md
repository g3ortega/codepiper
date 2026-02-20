# Theme System

CodePiper web now uses a preset-based theme architecture instead of a binary dark/light toggle.

## Goals

- Support multiple curated themes with consistent UI + terminal behavior.
- Keep contributor workflow simple: add one preset object, no component rewiring.
- Preserve compatibility with legacy `localStorage.theme` (`dark`/`light`) values.

## Source of Truth

- Presets: `packages/web/src/lib/themes/themePresets.ts`
- Types: `packages/web/src/lib/themes/types.ts`
- Runtime application + persistence: `packages/web/src/lib/themes/themeRuntime.ts`
- React state/context: `packages/web/src/contexts/ThemeContext.tsx`
- Picker UI: `packages/web/src/components/layout/ThemePicker.tsx`

## Runtime Flow

1. `ThemeProvider` resolves initial theme from storage or system preference.
2. Selected preset is applied to CSS variables (`--background`, `--primary`, etc.).
3. `document.documentElement.classList` is synced (`dark` on dark presets only).
4. `meta[name="theme-color"]` is updated per theme for browser UI tint.
5. Theme ID is persisted to `localStorage` under `codepiper.theme`.

```text
Theme selection -> ThemeContext -> themeRuntime
  |- CSS variables
  |- document class + meta theme-color
  |- xterm palette
  |- Monaco theme
  '- localStorage(codepiper.theme)
```

## Terminal + Editor Integration

- xterm.js palette is read from the active preset (`theme.terminal`) in:
  - `packages/web/src/components/terminal/TerminalView.tsx`
- Monaco diff editor theme is mapped through preset `monacoTheme`:
  - `packages/web/src/components/git/DiffViewer.tsx`

This keeps dashboard chrome, terminal ANSI palette, and diff viewer in sync.

## Add a New Theme

1. Copy an existing entry in `THEMES` (`themePresets.ts`).
2. Choose a unique `id`, `label`, and short `description`.
3. Fill `ui` palette with 6-digit hex colors.
4. Fill `terminal` palette with ANSI/xterm colors.
5. Set:
   - `mode` (`light` or `dark`)
   - `themeColor` (browser UI tint)
   - `monacoTheme` (`vs` or `vs-dark`)

No route/component changes are required; pickers and runtime wiring are dynamic.

```text
New preset checklist
--------------------
themePresets.ts: add preset
  -> Theme picker auto-discovers
  -> Runtime applies ui/terminal variables
  -> Terminal + diff viewer sync automatically
```

## Verification Checklist For New Themes

Before shipping a new preset:

1. Verify text contrast on cards/popovers/forms in both desktop and mobile layouts.
2. Verify toast/notification/readability surfaces against theme background (no illegible translucency).
3. Verify terminal cursor/selection colors remain visible.
4. Verify destructive/warning states remain distinct and readable.

## Notes

- Light themes should keep adequate contrast for borders and muted text.
- Keep destructive colors readable in both UI and terminal contexts.
- If a preset color is invalid hex, runtime conversion will throw during apply.
