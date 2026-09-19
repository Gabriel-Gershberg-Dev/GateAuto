import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import en from '../src/i18n/locales/en.json';
import he from '../src/i18n/locales/he.json';
import ru from '../src/i18n/locales/ru.json';
import {
  isRtlLanguage,
  languageFromTag,
  parseLanguagePreference,
  resolveLanguage,
} from '../src/i18n/locale';
import {
  glueTrailingNumber,
  isolateBidiText,
  logicalFlexDirection,
  LRI,
  PDI,
  RLI,
} from '../src/i18n/bidi';

function flatten(
  obj: Record<string, unknown>,
  prefix = '',
): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatten(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

function leaf(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    cur = (cur as Record<string, unknown>)[p];
  }
  return String(cur);
}

describe('locale resolution', () => {
  it('keeps English for unknown device tags (current UI default)', () => {
    assert.equal(languageFromTag('en-US'), 'en');
    assert.equal(languageFromTag('fr-FR'), 'en');
    assert.equal(resolveLanguage('system', 'en-IL'), 'en');
  });

  it('maps Hebrew and Russian device tags', () => {
    assert.equal(languageFromTag('he-IL'), 'he');
    assert.equal(languageFromTag('iw'), 'he');
    assert.equal(languageFromTag('ru-RU'), 'ru');
    assert.equal(resolveLanguage('system', 'he-IL'), 'he');
    assert.equal(resolveLanguage('system', 'ru'), 'ru');
  });

  it('honors an explicit picker choice over the device', () => {
    assert.equal(resolveLanguage('en', 'he-IL'), 'en');
    assert.equal(resolveLanguage('he', 'en-US'), 'he');
    assert.equal(parseLanguagePreference(null), 'system');
    assert.equal(parseLanguagePreference('ru'), 'ru');
  });

  it('marks only Hebrew as RTL', () => {
    assert.equal(isRtlLanguage('he'), true);
    assert.equal(isRtlLanguage('en'), false);
    assert.equal(isRtlLanguage('ru'), false);
  });
});

describe('translation catalogs', () => {
  const enKeys = flatten(en as Record<string, unknown>);
  const heKeys = new Set(flatten(he as Record<string, unknown>));
  const ruKeys = new Set(flatten(ru as Record<string, unknown>));

  it('keeps the same English keys in Hebrew and Russian', () => {
    const missingHe = enKeys.filter((k) => !heKeys.has(k));
    const missingRu = enKeys.filter((k) => !ruKeys.has(k));
    assert.deepEqual(missingHe, []);
    assert.deepEqual(missingRu, []);
  });

  it('keeps PalGate, GateAuto, Open, and Auto-open as product words', () => {
    for (const key of ['brand', 'open', 'autoOpen', 'palGate'] as const) {
      assert.equal(leaf(he as Record<string, unknown>, key), leaf(en as Record<string, unknown>, key));
      assert.equal(leaf(ru as Record<string, unknown>, key), leaf(en as Record<string, unknown>, key));
    }
    assert.match(he.autoOpen.title, /Auto-open/);
    assert.match(ru.autoOpen.title, /Auto-open/);
    assert.match(he.gates.opened, /Opened/);
    assert.equal(he.open, 'Open');
    assert.equal(ru.open, 'Open');
  });

  it('does not tell the user to quit the app after a language change', () => {
    for (const body of [
      en.lang.restartToRtl,
      en.lang.restartToLtr,
      he.lang.restartToRtl,
      he.lang.restartToLtr,
      ru.lang.restartToRtl,
      ru.lang.restartToLtr,
    ]) {
      assert.doesNotMatch(body, /swipe|force-quit|force quit|סגרו את|закройте/i);
    }
  });
});

describe('RTL bidi helpers', () => {
  it('glues a trailing index so it cannot wrap alone', () => {
    assert.equal(glueTrailingNumber('החנית 1'), 'החנית\u00A01');
    assert.equal(glueTrailingNumber('Parking 12'), 'Parking\u00A012');
    assert.equal(glueTrailingNumber('שער'), 'שער');
  });

  it('isolates Hebrew names with RLI and English with LRI', () => {
    const heName = isolateBidiText('החנית 1', true);
    assert.equal(heName[0], RLI);
    assert.ok(heName.endsWith(PDI));
    assert.ok(heName.includes('\u00A0'));
    const enName = isolateBidiText('Gate 1', false);
    assert.equal(enName[0], LRI);
  });

  it('avoids double-flipping Yoga row when native RTL already matches', () => {
    assert.equal(logicalFlexDirection(false, false), 'row');
    assert.equal(logicalFlexDirection(true, true), 'row');
    assert.equal(logicalFlexDirection(true, false), 'row-reverse');
    assert.equal(logicalFlexDirection(false, true), 'row-reverse');
  });
});
