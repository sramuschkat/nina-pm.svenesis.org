/**
 * Theme (`light`/`dark`) und Dichte (`compact`/`normal`/`wide`) als `data-theme`/`data-density` am
 * `<html>` (TK 11.3). Sofortwert aus `localStorage` gegen Aufblitzen; im Mandanten-Kontext zusätzlich in
 * `user_preference` (geräteübergreifend). Kein Rotlicht-Modus.
 */
import { DENSITIES, STORAGE_KEYS, THEMES, type Density, type Theme } from '@nina-pm/ui-tokens';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { readStorage, writeStorage } from './storage';

export function storedTheme(): Theme {
  const v = readStorage(STORAGE_KEYS.theme);
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as Theme) : 'light';
}

export function storedDensity(): Density {
  const v = readStorage(STORAGE_KEYS.density);
  return (DENSITIES as readonly string[]).includes(v ?? '') ? (v as Density) : 'normal';
}

/** Vor dem ersten Rendern aufrufen (main.tsx), damit kein helles Aufblitzen entsteht. */
export function applyStoredAppearance(): void {
  document.documentElement.dataset.theme = storedTheme();
  document.documentElement.dataset.density = storedDensity();
}

interface AppearanceValue {
  theme: Theme;
  density: Density;
  setTheme(theme: Theme): void;
  setDensity(density: Density): void;
}

const AppearanceContext = createContext<AppearanceValue | null>(null);

export interface AppearanceProviderProps {
  children: ReactNode;
  /** Speichert eine Wahl dauerhaft (user_preference); fehlt im Anmelde-/Systemkontext. */
  persist?: ((key: 'ui.theme' | 'ui.density', value: string) => void) | undefined;
  /** Serverwerte (user_preference) nach dem Laden übernehmen. */
  serverTheme?: Theme | undefined;
  serverDensity?: Density | undefined;
}

export function AppearanceProvider({
  children,
  persist,
  serverTheme,
  serverDensity,
}: AppearanceProviderProps) {
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const [density, setDensityState] = useState<Density>(storedDensity);

  useEffect(() => {
    if (serverTheme) setThemeState(serverTheme);
  }, [serverTheme]);
  useEffect(() => {
    if (serverDensity) setDensityState(serverDensity);
  }, [serverDensity]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage(STORAGE_KEYS.theme, theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.density = density;
    writeStorage(STORAGE_KEYS.density, density);
  }, [density]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      persist?.('ui.theme', next);
    },
    [persist],
  );
  const setDensity = useCallback(
    (next: Density) => {
      setDensityState(next);
      persist?.('ui.density', next);
    },
    [persist],
  );

  const value = useMemo(
    () => ({ theme, density, setTheme, setDensity }),
    [theme, density, setTheme, setDensity],
  );
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance außerhalb von AppearanceProvider');
  return ctx;
}
