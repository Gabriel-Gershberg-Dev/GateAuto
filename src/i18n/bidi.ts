/**
 * Layout/text helpers that do not import react-native (Node tests).
 * Yoga flips `flexDirection: 'row'` when I18nManager.isRTL — pass that flag
 * in so we never double-reverse.
 */

export const LRI = '\u2066';
export const RLI = '\u2067';
export const PDI = '\u2069';

/** Keep a trailing index with its word so `החנית 1` will not wrap the digit. */
export function glueTrailingNumber(text: string): string {
  return text.replace(/[ \u00A0]+(\d+)\s*$/u, '\u00A0$1');
}

export function isolateBidiText(text: string, rtl: boolean): string {
  const glued = glueTrailingNumber(text);
  return `${rtl ? RLI : LRI}${glued}${PDI}`;
}

export function logicalFlexDirection(
  wantRtl: boolean,
  nativeRtl: boolean,
): 'row' | 'row-reverse' {
  return wantRtl === nativeRtl ? 'row' : 'row-reverse';
}
