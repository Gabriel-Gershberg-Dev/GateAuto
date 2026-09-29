import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WIDGET_CHIPS_PER_PAGE,
  widgetChipPageCount,
  widgetChipPageIndex,
  widgetChipRange,
  widgetChipsPerPage,
} from '../src/data/widgetLayout';

describe('widget chip paging', () => {
  it('uses two cubes on a narrow strip and three when it is wide', () => {
    assert.equal(WIDGET_CHIPS_PER_PAGE, 3);
    assert.equal(widgetChipsPerPage(220), 2);
    assert.equal(widgetChipsPerPage(259), 2);
    assert.equal(widgetChipsPerPage(260), 3);
  });

  it('pages three cubes at a time by default', () => {
    assert.equal(widgetChipPageCount(0), 0);
    assert.equal(widgetChipPageCount(3), 1);
    assert.equal(widgetChipPageCount(4), 2);
    assert.equal(widgetChipPageCount(6), 2);
  });

  it('pages two cubes at a time on a narrow strip', () => {
    assert.equal(widgetChipPageCount(6, 2), 3);
    assert.deepEqual(widgetChipRange(0, 6, 2), { start: 0, end: 2 });
    assert.deepEqual(widgetChipRange(2, 6, 2), { start: 4, end: 6 });
  });

  it('clamps the page and slices the visible cubes', () => {
    assert.equal(widgetChipPageIndex(-1, 6), 0);
    assert.equal(widgetChipPageIndex(9, 6), 1);
    assert.deepEqual(widgetChipRange(0, 6), { start: 0, end: 3 });
    assert.deepEqual(widgetChipRange(1, 6), { start: 3, end: 6 });
    assert.deepEqual(widgetChipRange(1, 4), { start: 3, end: 4 });
  });
});
