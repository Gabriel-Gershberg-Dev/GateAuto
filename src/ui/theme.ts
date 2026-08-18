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
  overlay: string;
};

/**
 * Light: cool mist over white cards — night-drive HUD.
 * Accent: deep cabin teal from the GateAuto mark (`#1A4A47`).
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
  overlay: 'rgba(16, 20, 26, 0.42)',
};

/**
 * Dark: ink field, lifted cards, cabin-teal as a lamp — not a washed room.
 * Icon teal (#0D3D42) stays the identity; #2FBFB3 is that same cabin, lit.
 */
export const darkColors: ThemeColors = {
  background: '#030607',
  surface: '#171F21',
  text: '#F4FBF9',
  muted: '#C5D6D2',
  primary: '#2FBFB3',
  primaryMuted: '#0E2F2C',
  primaryOn: '#031614',
  border: '#4A6864',
  danger: '#FF7A8A',
  dangerBg: '#3A1520',
  warning: '#F5C84B',
  warningBg: '#3A2E0E',
  success: '#3EE89A',
  successBg: '#0F2E22',
  successBorder: '#2A7A58',
  successBadge: '#B6F5D4',
  successBadgeBg: '#164A36',
  fail: '#FF7A8A',
  failBg: '#3A1520',
  failBorder: '#7A3544',
  failBadge: '#FFD0D6',
  failBadgeBg: '#4A1C28',
  switchThumbOff: '#8A9B98',
  shadow: '#000000',
  mapFill: 'rgba(47, 191, 179, 0.28)',
  surfacePressed: '#222C2E',
  divider: 'rgba(244, 251, 249, 0.16)',
  overlay: 'rgba(0, 0, 0, 0.72)',
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
    borderWidth: 1,
    borderColor: c.border,
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
