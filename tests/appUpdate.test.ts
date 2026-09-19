import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isFetchedUpdateConfig,
  isHttpsApkUrl,
  isIntegerVersionCode,
  parseRemoteUpdateChannels,
  parseRemoteUpdateConfig,
  parseVersionCode,
  readRemoteConfigEntries,
  shouldOfferUpdate,
} from '../src/updates/updateLogic';
import { shouldPostUpdateNotice } from '../src/updates/updateNoticeLogic';

describe('sideload Remote Config update', () => {
  it('offers only when remote versionCode is higher and apk_url is HTTPS', () => {
    const remote = parseRemoteUpdateConfig({
      latest_version_code: '3',
      latest_version_name: '1.0.2',
      apk_url: 'https://example.com/GateAuto.apk',
      release_notes: 'Fixes',
    });
    assert.equal(remote.latestVersionCode, 3);
    assert.equal(
      shouldOfferUpdate({ installedVersionCode: 2, remote }),
      true,
    );
    assert.equal(
      shouldOfferUpdate({ installedVersionCode: 3, remote }),
      false,
    );
  });

  it('does not offer http URLs or an empty apk_url', () => {
    assert.equal(isHttpsApkUrl('http://evil.example/a.apk'), false);
    assert.equal(isHttpsApkUrl(''), false);
    assert.equal(
      shouldOfferUpdate({
        installedVersionCode: 1,
        remote: parseRemoteUpdateConfig({
          latest_version_code: '9',
          apk_url: '',
        }),
      }),
      false,
    );
  });

  it('parses integer version codes from strings', () => {
    assert.equal(parseVersionCode('2'), 2);
    assert.equal(parseVersionCode(2.9), 2);
    assert.equal(parseVersionCode('nope'), 0);
    assert.equal(isIntegerVersionCode('3'), true);
    assert.equal(isIntegerVersionCode('1.0.2'), false);
  });

  it('reads Firebase fetch REST entries as plain strings or {value}', () => {
    const fromLiveApi = readRemoteConfigEntries({
      latest_version_code: '3',
      latest_version_name: '1.0.2',
      apk_url: 'https://example.com/GateAuto.apk',
      release_notes: 'Fixes',
    });
    assert.equal(fromLiveApi.latest_version_code, '3');
    assert.equal(fromLiveApi.apk_url, 'https://example.com/GateAuto.apk');

    const fromDocsShape = readRemoteConfigEntries({
      latest_version_code: { value: '3' },
      apk_url: { value: 'https://example.com/GateAuto.apk' },
    });
    assert.equal(fromDocsShape.latest_version_code, '3');
    assert.equal(fromDocsShape.apk_url, 'https://example.com/GateAuto.apk');

    const fromNumber = readRemoteConfigEntries({ latest_version_code: 3 });
    assert.equal(fromNumber.latest_version_code, '3');

    const empty = parseRemoteUpdateConfig(readRemoteConfigEntries({}));
    assert.equal(isFetchedUpdateConfig(empty), false);
    assert.equal(
      shouldOfferUpdate({ installedVersionCode: 2, remote: empty }),
      false,
    );
  });

  it('does not offer when installed versionCode already matches remote', () => {
    const remote = parseRemoteUpdateConfig({
      latest_version_code: '5',
      latest_version_name: '1.0.4',
      apk_url: 'https://example.com/GateAuto.apk',
    });
    assert.equal(
      shouldOfferUpdate({ installedVersionCode: 5, remote }),
      false,
    );
    assert.equal(
      shouldOfferUpdate({ installedVersionCode: 4, remote }),
      true,
    );
  });

  it('does not offer production when the phone is already on a newer beta build', () => {
    const production = parseRemoteUpdateConfig({
      latest_version_code: '13',
      latest_version_name: '1.0.12',
      apk_url: 'https://example.com/GateAuto.apk',
    });
    assert.equal(
      shouldOfferUpdate({ installedVersionCode: 14, remote: production }),
      false,
    );
  });

  it('parses beta keys separately from production REST strings', () => {
    const values = readRemoteConfigEntries({
      latest_version_code: '13',
      latest_version_name: '1.0.12',
      apk_url: 'https://example.com/GateAuto.apk',
      release_notes: 'Family',
      beta_version_code: '14',
      beta_version_name: '1.0.13',
      beta_apk_url: 'https://example.com/GateAuto-beta.apk',
      beta_release_notes: 'Beta',
    });
    const channels = parseRemoteUpdateChannels(values);
    assert.equal(channels.production.latestVersionCode, 13);
    assert.equal(channels.production.releaseNotes, 'Family');
    assert.equal(channels.beta.latestVersionCode, 14);
    assert.equal(channels.beta.latestVersionName, '1.0.13');
    assert.equal(channels.beta.apkUrl, 'https://example.com/GateAuto-beta.apk');
    assert.equal(parseRemoteUpdateConfig(values).apkUrl, channels.production.apkUrl);
    assert.equal(
      shouldOfferUpdate({
        installedVersionCode: 13,
        remote: channels.production,
      }),
      false,
    );
    assert.equal(
      shouldOfferUpdate({
        installedVersionCode: 13,
        remote: channels.beta,
      }),
      true,
    );
  });
});

describe('update tray notice', () => {
  it('posts once per remote versionCode when the toggle is on', () => {
    assert.equal(
      shouldPostUpdateNotice({
        enabled: true,
        willOffer: true,
        versionCode: 31,
        lastNotifiedCode: 0,
      }),
      true,
    );
    assert.equal(
      shouldPostUpdateNotice({
        enabled: true,
        willOffer: true,
        versionCode: 31,
        lastNotifiedCode: 31,
      }),
      false,
    );
  });

  it('does not post when the toggle is off or there is no offer', () => {
    assert.equal(
      shouldPostUpdateNotice({
        enabled: false,
        willOffer: true,
        versionCode: 31,
        lastNotifiedCode: 0,
      }),
      false,
    );
    assert.equal(
      shouldPostUpdateNotice({
        enabled: true,
        willOffer: false,
        versionCode: 31,
        lastNotifiedCode: 0,
      }),
      false,
    );
  });
});
