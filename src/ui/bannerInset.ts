/**
 * Offset for the global open-result overlay so it sits below the status bar /
 * camera cutout. RN `paddingTop` on an absolutely filled host does not push
 * absolutely positioned children down — callers must set `top` instead.
 */
export function bannerTopOffset(
  insetsTop: number,
  statusBarHeight: number,
  platform: string,
): number {
  const inset = Number.isFinite(insetsTop) ? insetsTop : 0;
  const status = Number.isFinite(statusBarHeight) ? statusBarHeight : 0;
  const raw = Math.max(0, inset, status);
  if (raw > 0) return raw;
  // Edge-to-edge Android can report 0 until metrics settle.
  return platform === 'android' ? 48 : 12;
}
