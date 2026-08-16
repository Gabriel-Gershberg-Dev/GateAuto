/** Reorder a list by stable id. No-op at the ends. */
export function moveById<T extends { id: string }>(
  items: T[],
  id: string,
  direction: 'up' | 'down',
): T[] {
  const idx = items.findIndex((item) => item.id === id);
  if (idx < 0) return items;
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= items.length) return items;
  const next = items.slice();
  const a = next[idx];
  const b = next[swap];
  if (!a || !b) return items;
  next[idx] = b;
  next[swap] = a;
  return next;
}

/** Move an item to an absolute index. No-op if already there. */
export function moveToIndex<T extends { id: string }>(
  items: T[],
  id: string,
  toIndex: number,
): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return items;
  const clamped = Math.max(0, Math.min(items.length - 1, Math.round(toIndex)));
  if (from === clamped) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  if (!item) return items;
  next.splice(clamped, 0, item);
  return next;
}
