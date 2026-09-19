import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { shadeKindVisible } from '../src/notifications/noticeLogic';
import { shouldPostUpdateNotice } from '../src/updates/updateNoticeLogic';

describe('notification kind visibility', () => {
  it('defaults on when prefs are missing', () => {
    assert.equal(shadeKindVisible(undefined, undefined), true);
    assert.equal(shadeKindVisible(true, true), true);
  });

  it('hides a kind when the master switch is off', () => {
    assert.equal(shadeKindVisible(false, true), false);
    assert.equal(shadeKindVisible(false, false), false);
  });

  it('hides a kind when only that kind is off', () => {
    assert.equal(shadeKindVisible(true, false), false);
  });
});

describe('update tray honors the master switch', () => {
  it('does not post when all notifications are off', () => {
    assert.equal(
      shouldPostUpdateNotice({
        enabled: true,
        allEnabled: false,
        willOffer: true,
        versionCode: 44,
        lastNotifiedCode: 0,
      }),
      false,
    );
  });
});

describe('native open and searching notices honor prefs', () => {
  it('PalGateNativeOpen skips the opened ping when the pref is off', () => {
    const java = fs.readFileSync(
      path.join(
        process.cwd(),
        'src',
        'platform',
        'android-keepalive',
        'PalGateNativeOpen.java',
      ),
      'utf8',
    );
    assert.ok(java.includes('if (!KeepAlivePrefs.gateOpenNoticeVisible(context)) return;'));
  });

  it('KeepAlivePrefs combines master and kind toggles', () => {
    const java = fs.readFileSync(
      path.join(
        process.cwd(),
        'src',
        'platform',
        'android-keepalive',
        'KeepAlivePrefs.java',
      ),
      'utf8',
    );
    assert.ok(java.includes('return noticesEnabled(context) && monitorNoticeEnabled(context);'));
    assert.ok(java.includes('return noticesEnabled(context) && gateOpenNoticeEnabled(context);'));
  });
});
