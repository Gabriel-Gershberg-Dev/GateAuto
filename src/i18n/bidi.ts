/**
 * Layout/text helpers that do not import react-native (Node tests).
 * Yoga flips `flexDirection: 'row'` when I18nManager.isRTL — pass that flag
 * in so we never double-reverse.
 */

export const LRI = '\u2066';
export const RLI = '\u2067';
export const PDI = '\u2069';
export const RLM = '\u200F';

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

/**
 * React Native swaps `textAlign` left/right when I18nManager.isRTL, so 'left'
 * already means the reading start there. Returning 'right' for Hebrew in a
 * native-RTL app lands every wrapped line on the left.
 */
export function logicalTextAlign(
  wantRtl: boolean,
  nativeRtl: boolean,
): 'left' | 'right' {
  return wantRtl === nativeRtl ? 'left' : 'right';
}

/**
 * TextInput is the exception: Android maps its `textAlign` straight to
 * Gravity.LEFT / RIGHT with no RTL swap, so the typed text and the hint need
 * the physical side.
 */
export function inputTextAlign(wantRtl: boolean): 'left' | 'right' {
  return wantRtl ? 'right' : 'left';
}

/** Versions, ranges and codes read left-to-right inside Hebrew text. */
export function ltrIsolate(text: string): string {
  return `${LRI}${text}${PDI}`;
}

/**
 * A Hebrew string that opens with "Auto-open" or "Open" would otherwise take
 * an LTR base from its first strong letter and scramble the punctuation.
 */
export function withRtlMark(text: string): string {
  return text.startsWith(RLM) ? text : `${RLM}${text}`;
}

/**
 * Toggle thumb offset from the track's layout start. "On" sits at the reading
 * end (left in Hebrew, like Android's own RTL switches) on every vendor, since
 * Xiaomi does not mirror the platform Switch.
 */
export function toggleThumbOffset(
  on: boolean,
  wantRtl: boolean,
  nativeRtl: boolean,
  travel: number,
): number {
  const startIsLeft = !nativeRtl;
  const thumbAtLeft = on ? wantRtl : !wantRtl;
  if (thumbAtLeft === startIsLeft) return 0;
  return startIsLeft ? travel : -travel;
}
