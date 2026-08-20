import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, useColorScheme } from 'react-native';
import {
  THEME_PREF_KEY,
  colorsForScheme,
  navigationThemeFor,
  resolveScheme,
  type ThemeColors,
  type ThemePreference,
} from './theme';
import type { Theme as NavTheme } from '@react-navigation/native';

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  scheme: 'light' | 'dark';
  colors: ThemeColors;
  navigationTheme: NavTheme;
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function parsePreference(raw: string | null): ThemePreference {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(THEME_PREF_KEY);
        if (!cancelled) setPreferenceState(parsePreference(raw));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    void AsyncStorage.setItem(THEME_PREF_KEY, pref);
  }, []);

  const scheme = resolveScheme(
    preference,
    systemScheme ?? Appearance.getColorScheme(),
  );
  const colors = colorsForScheme(scheme);
  const navigationTheme = useMemo(
    () => navigationThemeFor(scheme, colors),
    [scheme, colors],
  );

  const value = useMemo(
    () => ({
      preference,
      setPreference,
      scheme,
      colors,
      navigationTheme,
      ready,
    }),
    [preference, setPreference, scheme, colors, navigationTheme, ready],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
