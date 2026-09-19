import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';
import { Platform, StyleSheet } from 'react-native';

/** Cabin-HUD lamp — hint frame, selection rail, auto-on arcs. */
export const HUD_TEAL = '#3AA99C';
export const HUD_TEAL_LINE = 'rgba(58, 169, 156, 0.28)';

export function hudFrameStyle() {
  return {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HUD_TEAL,
    overflow: 'hidden' as const,
  };
}

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
 * Light: cool mist, white cards with real shade — cabin teal from the mark.
 * Default appearance. Cards sit above `#E7EEEC` so they read as surfaces.
 */
export const lightColors: ThemeColors = {
  background: '#E7EEEC',
  surface: '#FFFFFF',
  text: '#10141A',
  muted: '#4E5F5C',
  primary: '#1A4A47',
  primaryMuted: '#D4E4E2',
  primaryOn: '#FFFFFF',
  border: '#D5E0DD',
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
  shadow: '#0B1210',
  mapFill: 'rgba(26, 74, 71, 0.16)',
  surfacePressed: '#DCE6E3',
  divider: 'rgba(16, 20, 26, 0.08)',
  overlay: 'rgba(16, 20, 26, 0.42)',
};

/**
 * Dark: ink field, lifted charcoal cards, cabin teal as a lamp.
 * Not electric blue, not a muddy wash — high contrast, readable type.
 */
export const darkColors: ThemeColors = {
  background: '#050808',
  surface: '#1C2628',
  text: '#F6FFFC',
  muted: '#9BB0AB',
  primary: '#3AA99C',
  primaryMuted: '#14302E',
  primaryOn: '#041210',
  border: '#3E5854',
  danger: '#FF8A96',
  dangerBg: '#3A1520',
  warning: '#F5C84B',
  warningBg: '#3A2E0E',
  success: '#4AD89A',
  successBg: '#0F2E22',
  successBorder: '#2A7A58',
  successBadge: '#B6F5D4',
  successBadgeBg: '#164A36',
  fail: '#FF8A96',
  failBg: '#3A1520',
  failBorder: '#7A3544',
  failBadge: '#FFD0D6',
  failBadgeBg: '#4A1C28',
  switchThumbOff: '#8A9B98',
  shadow: '#000000',
  mapFill: 'rgba(58, 169, 156, 0.28)',
  surfacePressed: '#273234',
  divider: 'rgba(246, 255, 252, 0.12)',
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
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 5 },
      default: {},
    }),
  };
}

/** Settings middle cards — same shade as Group, chips may overflow. */
export function paddedCardStyle(c: ThemeColors) {
  return {
    ...groupStyle(c),
    overflow: 'visible' as const,
    padding: spacing.md,
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
