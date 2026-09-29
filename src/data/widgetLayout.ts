/**
 * Widget strip columns. Mirrored by {@code WidgetRenderer}.
 * Narrow strips show 2 cubes so they stay cube-shaped; wide strips show 3.
 * Extra gates wrap onto the next row; the strip is a ListView of those rows
 * because home screens take left/right for their own pages.
 */
export const WIDGET_CHIPS_PER_PAGE = 3;
export const WIDGET_NARROW_STRIP_MAX_DP = 260;

export function widgetChipsPerPage(minWidthDp: number): number {
  const w = Math.max(0, Math.floor(Number(minWidthDp)));
  if (w > 0 && w < WIDGET_NARROW_STRIP_MAX_DP) return 2;
  return WIDGET_CHIPS_PER_PAGE;
}

export function widgetChipPageCount(
  gateCount: number,
  perPage: number = WIDGET_CHIPS_PER_PAGE,
): number {
  const n = Math.max(0, Math.floor(Number(gateCount)));
  const p = Math.max(1, Math.floor(Number(perPage)) || WIDGET_CHIPS_PER_PAGE);
  if (n <= 0) return 0;
  return Math.ceil(n / p);
}

export function widgetChipPageIndex(
  page: number,
  gateCount: number,
  perPage: number = WIDGET_CHIPS_PER_PAGE,
): number {
  const pages = widgetChipPageCount(gateCount, perPage);
  if (pages <= 0) return 0;
  const p = Math.floor(Number(page));
  if (!Number.isFinite(p) || p < 0) return 0;
  return Math.min(p, pages - 1);
}

export function widgetChipRange(
  page: number,
  gateCount: number,
  perPage: number = WIDGET_CHIPS_PER_PAGE,
): { start: number; end: number } {
  const n = Math.max(0, Math.floor(Number(gateCount)));
  const p = Math.max(1, Math.floor(Number(perPage)) || WIDGET_CHIPS_PER_PAGE);
  const idx = widgetChipPageIndex(page, n, p);
  const start = idx * p;
  const end = Math.min(n, start + p);
  return { start, end };
}
