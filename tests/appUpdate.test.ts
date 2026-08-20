import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isFetchedUpdateConfig,
  isHttpsApkUrl,
  isIntegerVersionCode,
  parseRemoteUpdateConfig,
  parseVersionCode,
  readRemoteConfigEntries,
  shouldOfferUpdate,
} from '../src/updates/updateLogic';

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
});
