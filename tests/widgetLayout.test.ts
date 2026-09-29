import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WIDGET_CHIPS_PER_PAGE,
  widgetChipPageCount,
  widgetChipPageIndex,
  widgetChipRange,
} from '../src/data/widgetLayout';

describe('widget chip paging', () => {
  it('pages three cubes at a time', () => {
    assert.equal(WIDGET_CHIPS_PER_PAGE, 3);
    assert.equal(widgetChipPageCount(0), 0);
    assert.equal(widgetChipPageCount(3), 1);
    assert.equal(widgetChipPageCount(4), 2);
    assert.equal(widgetChipPageCount(6), 2);
  });

  it('clamps the page and slices the visible cubes', () => {
    assert.equal(widgetChipPageIndex(-1, 6), 0);
    assert.equal(widgetChipPageIndex(9, 6), 1);
    assert.deepEqual(widgetChipRange(0, 6), { start: 0, end: 3 });
    assert.deepEqual(widgetChipRange(1, 6), { start: 3, end: 6 });
    assert.deepEqual(widgetChipRange(1, 4), { start: 3, end: 4 });
  });
});
