import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashGateId, sanitizeParams } from '../src/telemetry/privacy';
import { mapLogEvent } from '../src/telemetry/mapLogEvent';

describe('hashGateId', () => {
  it('is stable and does not echo the PalGate deviceId', () => {
    const id = 'abc123device:2';
    const hash = hashGateId(id);
    assert.match(hash, /^g_[0-9a-f]{8}$/);
    assert.equal(hash, hashGateId(id));
    assert.equal(hash.includes(id), false);
    assert.notEqual(hash, hashGateId('other-gate'));
  });

  it('uses g_unknown for empty ids', () => {
    assert.equal(hashGateId(''), 'g_unknown');
    assert.equal(hashGateId('  '), 'g_unknown');
  });
});

describe('sanitizeParams', () => {
  it('drops coordinates, emails, tokens, and device ids', () => {
    const out = sanitizeParams({
      source: 'poll',
      lat: 32.08,
      email: 'a@b.c',
      token: 'secret',
      deviceId: 'palgate',
      distance_m: 12,
    });
    assert.deepEqual(out, { source: 'poll', distance_m: 12 });
  });
});

describe('mapLogEvent', () => {
  it('maps successful opens to auto_open sources', () => {
    assert.equal(
      mapLogEvent({ kind: 'opened', trigger: 'enter', gateId: 'g1' })?.source,
      'play_enter',
    );
    assert.equal(
      mapLogEvent({ kind: 'exit_open', trigger: 'exit', gateId: 'g1' })?.source,
      'play_exit',
    );
    assert.equal(
      mapLogEvent({ kind: 'bt_connect_open', trigger: 'bt_connect' })?.source,
      'bt',
    );
    assert.equal(
      mapLogEvent({ kind: 'poll_open', trigger: 'poll' })?.source,
      'poll',
    );
    assert.equal(
      mapLogEvent({ kind: 'eligible_now_open', trigger: 'eligible_now' })?.source,
      'recover',
    );
  });

  it('maps skips without sending the message field', () => {
    const skip = mapLogEvent({
      kind: 'skipped_refine',
      trigger: 'enter',
      gateId: 'secret-device',
      distanceM: 88,
    });
    assert.equal(skip?.type, 'auto_skip');
    if (skip?.type !== 'auto_skip') return;
    assert.equal(skip.reason, 'outside_radius');
    assert.equal(skip.source, 'play_enter');
    assert.equal(skip.gateHash, hashGateId('secret-device'));
    assert.equal(skip.distanceM, 88);
    assert.equal(JSON.stringify(skip).includes('secret-device'), false);
  });

  it('ignores test events', () => {
    assert.equal(
      mapLogEvent({ kind: 'test_opened', trigger: 'manual_test' }),
      null,
    );
    assert.equal(
      mapLogEvent({ kind: 'opened', trigger: 'manual_test' }),
      null,
    );
  });

  it('maps cooldown and safety lock', () => {
    const cooldown = mapLogEvent({ kind: 'cooldown' });
    assert.equal(cooldown?.type, 'auto_skip');
    if (cooldown?.type === 'auto_skip') assert.equal(cooldown.reason, 'cooldown');
    const lock = mapLogEvent({ kind: 'safety_lock' });
    assert.equal(lock?.type, 'auto_skip');
    if (lock?.type === 'auto_skip') assert.equal(lock.reason, 'safety_lock');
    const bt = mapLogEvent({ kind: 'skipped_bt' });
    assert.equal(bt?.type, 'auto_skip');
    if (bt?.type === 'auto_skip') assert.equal(bt.reason, 'bt_missing');
  });
});
