/** Distinguishes a still long-press from a real pull on the first row. */
export const CARD_PULL_REFRESH_PX = 24;
export const CARD_SCROLL_SLOP_PX = 10;

export type ListRefreshLockInput = {
  selecting: boolean;
  dragging: boolean;
  cardFingerDown: boolean;
};

export function listRefreshEnabled({
  selecting,
  dragging,
  cardFingerDown,
}: ListRefreshLockInput): boolean {
  return !selecting && !dragging && !cardFingerDown;
}

export function isListAtTop(offsetY: number): boolean {
  return offsetY <= 1;
}

export type CardHoldMove = 'hold' | 'pullRefresh' | 'scroll';

/** Finger still on a card after press-in. Tiny jitter stays a hold. */
export function classifyCardHoldMove(
  dy: number,
  listAtTop: boolean,
): CardHoldMove {
  if (listAtTop && dy >= CARD_PULL_REFRESH_PX) return 'pullRefresh';
  if (dy <= -CARD_SCROLL_SLOP_PX) return 'scroll';
  if (!listAtTop && Math.abs(dy) >= CARD_SCROLL_SLOP_PX) return 'scroll';
  return 'hold';
}

export function shouldLockListScrollForCardHold(
  listAtTop: boolean,
  selecting: boolean,
): boolean {
  return listAtTop && !selecting;
}
