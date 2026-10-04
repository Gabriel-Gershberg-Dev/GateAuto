import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

describe('signed-out widget', () => {
  const root = path.join(__dirname, '..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('grays the widget and refuses gate taps while signed out', () => {
    const renderer = read('src/platform/android-widget/WidgetRenderer.java');
    const actions = read('src/platform/android-widget/WidgetActionReceiver.java');
    const factory = read('src/platform/android-widget/WidgetViewsService.java');
    const vault = read('src/data/accountVault.ts');
    assert.match(renderer, /bindSignedOut/);
    assert.match(renderer, /accountSignedIn/);
    assert.match(renderer, /widget_face_off/);
    assert.match(renderer, /widget_signed_out_detail/);
    assert.match(actions, /accountSignedIn/);
    assert.match(factory, /accountSignedIn\(app\)\) return 0/);
    assert.match(vault, /setNativeAccountSignedIn\(false\)/);
    assert.match(vault, /setNativeAccountSignedIn\(Boolean\(uid\)\)/);
    assert.doesNotMatch(vault, /leaveAccountVault[\s\S]*disarmNativeSession/);
  });
});
