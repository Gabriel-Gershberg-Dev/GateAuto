/** Effective shade visibility: master AND the kind toggle. Default on. */
export function shadeKindVisible(
  allEnabled: boolean | undefined,
  kindEnabled: boolean | undefined,
): boolean {
  return allEnabled !== false && kindEnabled !== false;
}
