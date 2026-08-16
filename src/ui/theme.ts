import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';
import { Platform } from 'react-native';

export type ThemePreference = 'system' | 'light' | 'dark';

export type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  primaryMuted: string;
  primaryOn: string;
  border: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  success: string;
  successBg: string;
  successBorder: string;
  successBadge: string;
  successBadgeBg: string;
  fail: string;
  failBg: string;
  failBorder: string;
  failBadge: string;
  failBadgeBg: string;
  switchThumbOff: string;
  shadow: string;
  mapFill: string;
  surfacePressed: string;
  divider: string;
};

/**
 * Light: cool mist over white cards — night-drive HUD, not rustic metal.
 * Accent: deep teal from the GateAuto mark (barrier at dusk).
 */
export const lightColors: ThemeColors = {
  background: '#F3F6F5',
  surface: '#FFFFFF',
  text: '#10141A',
  muted: '#5A6B68',
  primary: '#1A4A47',
  primaryMuted: '#D4E4E2',
  primaryOn: '#FFFFFF',
  border: '#E2E8E6',
  danger: '#E11D48',
  dangerBg: '#FDE8EE',
  warning: '#B45309',
  warningBg: '#FEF3C7',
  success: '#0F9F6E',
  successBg: '#DCFCE7',
  successBorder: '#86EFAC',
  successBadge: '#047857',
  successBadgeBg: '#BBF7D0',
  fail: '#E11D48',
  failBg: '#FDE8EE',
  failBorder: '#FECDD3',
  failBadge: '#BE123C',
  failBadgeBg: '#FECDD3',
  switchThumbOff: '#F8FAFC',
  shadow: '#10141A',
  mapFill: 'rgba(26, 74, 71, 0.16)',
  surfacePressed: '#E6EEEC',
  divider: 'rgba(16, 20, 26, 0.08)',
};

/**
 * Dark: cabin teal from the app icon (#0D3D42), not dull charcoal-grey.
 * Open uses a lifted pine green so it reads on the dark field.
 */
export const darkColors: ThemeColors = {
  background: '#071314',
  surface: '#122426',
  text: '#E7F3F0',
  muted: '#8BA8A4',
  primary: '#3D9A78',
  primaryMuted: '#1A3D38',
  primaryOn: '#041210',
  border: '#1E3A3A',
  danger: '#FB7185',
  dangerBg: '#3F1D2A',
  warning: '#FBBF24',
  warningBg: '#3F3214',
  success: '#4ADE80',
  successBg: '#163328',
  successBorder: '#27664C',
  successBadge: '#A7F3D0',
  successBadgeBg: '#1C4A3A',
  fail: '#FB7185',
  failBg: '#3F1D2A',
  failBorder: '#6B3040',
  failBadge: '#FECDD3',
  failBadgeBg: '#4A2430',
  switchThumbOff: '#6B7280',
  shadow: '#000000',
  mapFill: 'rgba(61, 154, 120, 0.22)',
  surfacePressed: '#1A3334',
  divider: 'rgba(231, 243, 240, 0.1)',
};

/** Light palette — prefer `useTheme().colors` in UI. */
export const colors = lightColors;

export const spacing = {
  sm: 8,
  md: 16,
  lg: 24,
};

export const radii = {
  sm: 12,
  md: 18,
  lg: 24,
  pill: 999,
};

export function groupStyle(c: ThemeColors) {
  return {
    backgroundColor: c.surface,
    borderRadius: radii.md,
    overflow: 'hidden' as const,
    ...Platform.select({
      ios: {
        shadowColor: c.shadow,
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
      default: {},
    }),
  };
}

export const type = {
  eyebrow: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
  },
  section: {
    fontSize: 17,
    fontWeight: '700' as const,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
  },
  mono: {
    fontSize: 12,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
};

export const THEME_PREF_KEY = '@gateauto/themePreference';

export function resolveScheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function colorsForScheme(scheme: 'light' | 'dark'): ThemeColors {
  return scheme === 'dark' ? darkColors : lightColors;
}

export function navigationThemeFor(
  scheme: 'light' | 'dark',
  c: ThemeColors,
): Theme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === 'dark',
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.background,
      card: c.surface,
      text: c.text,
      border: c.border,
      notification: c.danger,
    },
  };
}
