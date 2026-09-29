/**
 * Widget strip paging. Mirrored by {@code WidgetRenderer} chip pages.
 * Home-screen pagers steal horizontal swipes, so the wide strip pages 3 cubes
 * at a time instead of a HorizontalScrollView (not allowed in RemoteViews).
 */
export const WIDGET_CHIPS_PER_PAGE = 3;

export function widgetChipPageCount(gateCount: number): number {
  const n = Math.max(0, Math.floor(Number(gateCount)));
  if (n <= 0) return 0;
  return Math.ceil(n / WIDGET_CHIPS_PER_PAGE);
}

export function widgetChipPageIndex(page: number, gateCount: number): number {
  const pages = widgetChipPageCount(gateCount);
  if (pages <= 0) return 0;
  const p = Math.floor(Number(page));
  if (!Number.isFinite(p) || p < 0) return 0;
  return Math.min(p, pages - 1);
}

export function widgetChipRange(
  page: number,
  gateCount: number,
): { start: number; end: number } {
  const n = Math.max(0, Math.floor(Number(gateCount)));
  const idx = widgetChipPageIndex(page, n);
  const start = idx * WIDGET_CHIPS_PER_PAGE;
  const end = Math.min(n, start + WIDGET_CHIPS_PER_PAGE);
  return { start, end };
}
