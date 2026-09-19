import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CARD_PULL_REFRESH_PX,
  classifyCardHoldMove,
  isListAtTop,
  listRefreshEnabled,
  shouldLockListScrollForCardHold,
} from '../src/ui/listRefreshLock';

describe('listRefreshEnabled', () => {
  it('stays on for a real pull when no card is held', () => {
    assert.equal(
      listRefreshEnabled({
        selecting: false,
        dragging: false,
        cardFingerDown: false,
      }),
      true,
    );
  });

  it('turns off while a finger is down on a card', () => {
    assert.equal(
      listRefreshEnabled({
        selecting: false,
        dragging: false,
        cardFingerDown: true,
      }),
      false,
    );
  });

  it('stays off while entering or staying in select', () => {
    assert.equal(
      listRefreshEnabled({
        selecting: true,
        dragging: false,
        cardFingerDown: true,
      }),
      false,
    );
    assert.equal(
      listRefreshEnabled({
        selecting: true,
        dragging: false,
        cardFingerDown: false,
      }),
      false,
    );
  });

  it('stays off while dragging to reorder', () => {
    assert.equal(
      listRefreshEnabled({
        selecting: false,
        dragging: true,
        cardFingerDown: false,
      }),
      false,
    );
  });
});

describe('classifyCardHoldMove', () => {
  it('treats long-press jitter at the list top as a hold', () => {
    assert.equal(classifyCardHoldMove(0, true), 'hold');
    assert.equal(classifyCardHoldMove(8, true), 'hold');
    assert.equal(classifyCardHoldMove(12, true), 'hold');
    assert.equal(classifyCardHoldMove(-6, true), 'hold');
  });

  it('treats a real downward pull on row 0 as refresh', () => {
    assert.equal(
      classifyCardHoldMove(CARD_PULL_REFRESH_PX, true),
      'pullRefresh',
    );
    assert.equal(classifyCardHoldMove(40, true), 'pullRefresh');
  });

  it('releases the hold when the list should scroll', () => {
    assert.equal(classifyCardHoldMove(-16, true), 'scroll');
    assert.equal(classifyCardHoldMove(16, false), 'scroll');
    assert.equal(classifyCardHoldMove(-16, false), 'scroll');
  });
});

describe('list top helpers', () => {
  it('treats a 1px Android sliver as the top', () => {
    assert.equal(isListAtTop(0), true);
    assert.equal(isListAtTop(1), true);
    assert.equal(isListAtTop(2), false);
  });

  it('only locks scroll for a hold when refresh could fire', () => {
    assert.equal(shouldLockListScrollForCardHold(true, false), true);
    assert.equal(shouldLockListScrollForCardHold(true, true), false);
    assert.equal(shouldLockListScrollForCardHold(false, false), false);
  });
});
