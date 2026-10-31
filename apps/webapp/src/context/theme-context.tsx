import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { useSettings } from "@/hooks/use-settings";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  systemTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
}

const THEME_STORAGE_KEY = "quozen_theme_preference";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === "light" || val === "dark" || val === "system") {
      return val;
    }
  } catch (e) {
    // LocalStorage might be inaccessible (incognito / sandboxed iframe)
  }
  return "system";
}

export function applyThemeToDom(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // Modern Web Guidance: set color-scheme style & meta tag
  root.style.colorScheme = resolved;

  let colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
  if (!colorSchemeMeta) {
    colorSchemeMeta = document.createElement("meta");
    colorSchemeMeta.setAttribute("name", "color-scheme");
    document.head.appendChild(colorSchemeMeta);
  }
  colorSchemeMeta.setAttribute("content", resolved);

  // Modern PWA support: adapt theme-color for mobile chrome & status bar
  let themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeColorMeta) {
    themeColorMeta = document.createElement("meta");
    themeColorMeta.setAttribute("name", "theme-color");
    document.head.appendChild(themeColorMeta);
  }
  // Dark mode uses dark surface (#0F141C), Light mode uses brand primary (#0F766E)
  themeColorMeta.setAttribute("content", resolved === "dark" ? "#0F141C" : "#0F766E");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings, updateSettings } = useSettings();
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    // Preference precedence: UserSettings from cloud/db > LocalStorage > "system"
    const settingsTheme = settings?.preferences?.theme;
    if (settingsTheme === "light" || settingsTheme === "dark" || settingsTheme === "system") {
      return settingsTheme;
    }
    return getStoredTheme();
  });

  // Track system OS color scheme changes (iOS, Android, PWA, macOS, Windows)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else if ((mediaQuery as any).addListener) {
      (mediaQuery as any).addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else if ((mediaQuery as any).removeListener) {
        (mediaQuery as any).removeListener(handleChange);
      }
    };
  }, []);

  // Sync state if remote/db settings change across devices
  useEffect(() => {
    const remoteTheme = settings?.preferences?.theme;
    if (remoteTheme && (remoteTheme === "light" || remoteTheme === "dark" || remoteTheme === "system")) {
      setThemeState((current) => {
        if (current !== remoteTheme) {
          try {
            localStorage.setItem(THEME_STORAGE_KEY, remoteTheme);
          } catch (e) {
            // ignore
          }
          return remoteTheme;
        }
        return current;
      });
    }
  }, [settings?.preferences?.theme]);

  // Compute resolved theme
  const resolvedTheme: ResolvedTheme = useMemo(() => {
    return theme === "system" ? systemTheme : theme;
  }, [theme, systemTheme]);

  // Apply DOM updates whenever resolvedTheme changes
  useEffect(() => {
    applyThemeToDom(resolvedTheme);
  }, [resolvedTheme]);

  // Set theme callback: immediately updates DOM & state, caches to localStorage, and updates cloud settings
  const setTheme = useCallback(
    (newTheme: ThemeMode) => {
      setThemeState(newTheme);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      } catch (e) {
        // ignore
      }

      const newResolved = newTheme === "system" ? getSystemTheme() : newTheme;
      applyThemeToDom(newResolved);

      if (settings && updateSettings && settings.preferences?.theme !== newTheme) {
        updateSettings({
          ...settings,
          preferences: {
            ...settings.preferences,
            theme: newTheme,
          },
        });
      }
    },
    [settings, updateSettings]
  );

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      systemTheme,
      setTheme,
    }),
    [theme, resolvedTheme, systemTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const defaultThemeValue: ThemeContextValue = {
  theme: "system",
  resolvedTheme: "light",
  systemTheme: "light",
  setTheme: () => {},
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    return defaultThemeValue;
  }
  return context;
}
