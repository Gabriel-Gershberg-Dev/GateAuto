import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deviceMatchesGateBluetooth,
  listedCarIsConnected,
  matchesCarBluetooth,
  pollAllowsAutoOpen,
} from '../src/bluetooth/match';
import { displayGateName } from '../src/data/gateDisplay';
import { nativeRegionFromGate } from '../src/platform/nativeRegion';
import { normalizeBluetooth } from '../src/data/gateBluetooth';
import { normalizeCooldownMs } from '../src/data/cooldownNormalize';
import {
  isMainMonitoringEvent,
  isTestEvent,
} from '../src/data/eventFilters';
import {
  applyBurstOpen,
  BURST_COUNT,
  BURST_WINDOW_MS,
  clampBurstCount,
  clampLockMinutes,
  formatSafetyLockMessage,
  GATE_LOCK_MS,
  MAX_BURST_COUNT,
  MAX_GATE_LOCK_MINUTES,
  MIN_BURST_COUNT,
  MIN_GATE_LOCK_MINUTES,
} from '../src/data/safetyBurst';
import { moveById, moveToIndex } from '../src/data/gateOrder';
import { splitDeviceId } from '../src/palgate/api';
import { generateToken } from '../src/palgate/token';
import { TokenType } from '../src/palgate/types';

describe('matchesCarBluetooth / OR list', () => {
  const carA = { name: 'Audi MMI', address: 'AA:BB:CC:DD:EE:FF' };
  const carB = { name: 'Mazda', address: '11:22:33:44:55:66' };

  it('matches by address even if name differs', () => {
    assert.equal(
      matchesCarBluetooth(
        { name: 'Car', address: 'aa-bb-cc-dd-ee-ff' },
        { address: 'AA:BB:CC:DD:EE:FF' },
      ),
      true,
    );
  });

  it('matches by name when no address is saved', () => {
    assert.equal(
      matchesCarBluetooth({ name: 'Audi MMI' }, { name: 'audi mmi' }),
      true,
    );
  });

  it('OR: any listed car is enough', () => {
    assert.equal(deviceMatchesGateBluetooth(carB, [carA, carB]), true);
    assert.equal(
      deviceMatchesGateBluetooth(
        { name: 'Unknown', address: '00:00:00:00:00:00' },
        [carA, carB],
      ),
      false,
    );
  });
});

describe('listedCarIsConnected (native poll BT contract)', () => {
  const car = 'AABBCCDDEEFF';

  it('allows non-BT-required gates regardless of what is connected', () => {
    assert.equal(
      listedCarIsConnected({
        required: false,
        listedAddresses: [car],
        listedNames: [],
        connectedAddresses: [],
        connectedNames: [],
      }),
      true,
    );
  });

  it('fails closed when BT is required but no car is listed', () => {
    assert.equal(
      listedCarIsConnected({
        required: true,
        listedAddresses: [],
        listedNames: [],
        connectedAddresses: ['112233445566'],
        connectedNames: ['keyboard'],
      }),
      false,
    );
  });

  it('does not treat a random HID/GATT device as the listed car', () => {
    assert.equal(
      listedCarIsConnected({
        required: true,
        listedAddresses: [car],
        listedNames: ['Audi MMI'],
        connectedAddresses: ['112233445566'],
        connectedNames: ['galaxy buds', 'keyboard'],
      }),
      false,
    );
  });

  it('allows HID/GATT as a way to see the listed car MAC', () => {
    assert.equal(
      listedCarIsConnected({
        required: true,
        listedAddresses: ['AA:BB:CC:DD:EE:FF'],
        listedNames: [],
        connectedAddresses: [car],
        connectedNames: [],
      }),
      true,
    );
  });

  it('matches a listed name from any connected profile', () => {
    assert.equal(
      listedCarIsConnected({
        required: true,
        listedAddresses: [],
        listedNames: ['Audi MMI'],
        connectedAddresses: ['112233445566'],
        connectedNames: ['audi mmi'],
      }),
      true,
    );
  });
});

describe('pollAllowsAutoOpen', () => {
  it('opens non-BT gates from a location poll', () => {
    assert.equal(pollAllowsAutoOpen(false), true);
    assert.equal(pollAllowsAutoOpen(false, false), true);
  });

  it('opens BT-required gates from a poll only when a listed car is connected', () => {
    assert.equal(pollAllowsAutoOpen(true), false);
    assert.equal(pollAllowsAutoOpen(true, false), false);
    assert.equal(pollAllowsAutoOpen(true, true), true);
  });
});

describe('moveById', () => {
  const gates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('moves an item up and down', () => {
    assert.deepEqual(
      moveById(gates, 'b', 'up').map((g) => g.id),
      ['b', 'a', 'c'],
    );
    assert.deepEqual(
      moveById(gates, 'b', 'down').map((g) => g.id),
      ['a', 'c', 'b'],
    );
  });

  it('is a no-op at the ends or for unknown ids', () => {
    assert.equal(moveById(gates, 'a', 'up'), gates);
    assert.equal(moveById(gates, 'c', 'down'), gates);
    assert.equal(moveById(gates, 'missing', 'up'), gates);
  });

  it('moves an item to an absolute index', () => {
    assert.deepEqual(
      moveToIndex(gates, 'a', 2).map((g) => g.id),
      ['b', 'c', 'a'],
    );
    assert.equal(moveToIndex(gates, 'b', 1), gates);
  });
});

describe('normalizeCooldownMs', () => {
  it('keeps millisecond values', () => {
    assert.equal(normalizeCooldownMs(10_000), 10_000);
    assert.equal(normalizeCooldownMs(300_000), 300_000);
  });

  it('treats values under 1000 as seconds, not minutes', () => {
    assert.equal(normalizeCooldownMs(10), 10_000);
    assert.equal(normalizeCooldownMs(30), 30_000);
  });
});

describe('normalizeBluetooth', () => {
  it('migrates legacy single name/address into devices[]', () => {
    const bt = normalizeBluetooth({
      required: true,
      name: 'Audi',
      address: 'AA:BB:CC:DD:EE:FF',
    });
    assert.equal(bt.required, true);
    assert.equal(bt.devices.length, 1);
    assert.equal(bt.devices[0].name, 'Audi');
    assert.equal(bt.devices[0].address, 'AA:BB:CC:DD:EE:FF');
  });
});

describe('displayGateName', () => {
  it('prefers override, then PalGate name, then deviceId', () => {
    assert.equal(
      displayGateName({
        name: 'החניה',
        nameOverride: 'Parking',
        deviceId: 'ABC',
      }),
      'Parking',
    );
    assert.equal(
      displayGateName({ name: 'החניה', nameOverride: null, deviceId: 'ABC' }),
      'החניה',
    );
  });
});

describe('nativeRegionFromGate', () => {
  it('persists display name and per-gate Auto flag for native open/notify', () => {
    const region = nativeRegionFromGate({
      id: '4G300102168',
      deviceId: '4G300102168',
      systemId: null,
      origin: 'linked',
      sharedInviteCode: null,
      sharedFromName: null,
      name: 'ארלוזורוב 3',
      nameOverride: 'אלוזורוב',
      enabled: false,
      lat: 32.08,
      lng: 34.78,
      radiusMeters: 50,
      cooldownMs: 30_000,
      holdEnabled: false,
      holdMs: 0,
      bluetooth: { required: false, devices: [] },
      lastOpenedAt: null,
      lastResult: null,
    });
    assert.equal(region.enabled, false);
    assert.equal(region.btRequired, false);
    assert.equal(region.displayName, 'אלוזורוב');
    assert.equal(region.name, 'אלוזורוב');
    assert.notEqual(region.name, 'ארלוזורוב 3');
  });

  it('marks BT-required so native poll can skip the gate', () => {
    const region = nativeRegionFromGate({
      id: '4G300102168',
      deviceId: '4G300102168',
      systemId: null,
      origin: 'linked',
      sharedInviteCode: null,
      sharedFromName: null,
      name: 'קהילת ציון 4',
      nameOverride: null,
      enabled: true,
      lat: 32.08,
      lng: 34.78,
      radiusMeters: 50,
      cooldownMs: 30_000,
      holdEnabled: false,
      holdMs: 0,
      bluetooth: {
        required: true,
        devices: [{ name: 'Car', address: 'AA:BB:CC:DD:EE:FF' }],
      },
      lastOpenedAt: null,
      lastResult: null,
    });
    assert.equal(region.btRequired, true);
    assert.deepEqual(region.btAddresses, ['AA:BB:CC:DD:EE:FF']);
    assert.equal(pollAllowsAutoOpen(Boolean(region.btRequired)), false);
    assert.equal(pollAllowsAutoOpen(true, true), true);
    assert.equal(pollAllowsAutoOpen(false), true);
  });
});

describe('event log filters', () => {
  it('hides test_* from the main Monitoring log', () => {
    assert.equal(isTestEvent({ kind: 'test_opened' }), true);
    assert.equal(isMainMonitoringEvent({ kind: 'test_opened' }), false);
    assert.equal(isMainMonitoringEvent({ kind: 'eligible_now_open' }), true);
    assert.equal(isMainMonitoringEvent({ kind: 'poll_open' }), true);
  });
});

describe('applyBurstOpen (per-gate safety lock)', () => {
  it('does not lock after fewer than BURST_COUNT opens in the window', () => {
    const t0 = 1_000_000;
    let state = { lockUntil: null as number | null, openTimestamps: [] as number[] };
    for (let i = 0; i < BURST_COUNT - 1; i++) {
      const r = applyBurstOpen(state, t0 + i * 1_000);
      assert.equal(r.lockEngaged, false);
      state = r.next;
    }
    assert.equal(state.lockUntil, null);
    assert.equal(state.openTimestamps.length, BURST_COUNT - 1);
  });

  it('locks the gate on the Nth open within 2 minutes (default 3)', () => {
    const t0 = 1_000_000;
    let last = applyBurstOpen(
      { lockUntil: null, openTimestamps: [] },
      t0,
    );
    for (let i = 1; i < BURST_COUNT; i++) {
      last = applyBurstOpen(last.next, t0 + i * 1_000);
    }
    assert.equal(BURST_COUNT, 3);
    assert.equal(last.lockEngaged, true);
    assert.equal(last.remainingMs, GATE_LOCK_MS);
    assert.equal(GATE_LOCK_MS, 15 * 60 * 1000);
    assert.ok((last.next.lockUntil ?? 0) > t0);
  });

  it('uses a custom attempt count and lock duration', () => {
    const t0 = 1_000_000;
    const lockMs = 10 * 60 * 1000;
    let last = applyBurstOpen(
      { lockUntil: null, openTimestamps: [] },
      t0,
      { burstCount: 5, lockMs },
    );
    for (let i = 1; i < 5; i++) {
      last = applyBurstOpen(last.next, t0 + i * 1_000, {
        burstCount: 5,
        lockMs,
      });
    }
    assert.equal(last.lockEngaged, true);
    assert.equal(last.remainingMs, lockMs);
  });

  it('does not count opens outside the 2 minute window', () => {
    const t0 = 1_000_000;
    const first = applyBurstOpen(
      { lockUntil: null, openTimestamps: [t0] },
      t0 + BURST_WINDOW_MS + 1,
    );
    assert.equal(first.lockEngaged, false);
    assert.equal(first.next.openTimestamps.length, 1);
  });

  it('does not extend an already-active lock', () => {
    const now = 2_000_000;
    const lockUntil = now + 10 * 60_000;
    const r = applyBurstOpen({ lockUntil, openTimestamps: [] }, now);
    assert.equal(r.lockEngaged, false);
    assert.equal(r.next.lockUntil, lockUntil);
    assert.equal(r.remainingMs, 10 * 60_000);
  });
});

describe('safety lock setting clamps', () => {
  it('keeps attempts at least 3 and duration 5–120 minutes', () => {
    assert.equal(clampBurstCount(2), MIN_BURST_COUNT);
    assert.equal(clampBurstCount(3), 3);
    assert.equal(clampBurstCount(99), MAX_BURST_COUNT);
    assert.equal(clampLockMinutes(1), MIN_GATE_LOCK_MINUTES);
    assert.equal(clampLockMinutes(15), 15);
    assert.equal(clampLockMinutes(999), MAX_GATE_LOCK_MINUTES);
  });
});

describe('formatSafetyLockMessage', () => {
  it('ceils remaining time to minutes', () => {
    assert.match(formatSafetyLockMessage(1), /wait 1m/);
    assert.match(formatSafetyLockMessage(15 * 60 * 1000), /wait 15m/);
  });
});

describe('splitDeviceId', () => {
  it('defaults output 1 for a plain id', () => {
    assert.deepEqual(splitDeviceId('4G300102167'), {
      baseId: '4G300102167',
      outputNum: 1,
    });
  });

  it('parses multi-output ids', () => {
    assert.deepEqual(splitDeviceId('ABC:2'), { baseId: 'ABC', outputNum: 2 });
  });
});

describe('generateToken', () => {
  const session = '00112233445566778899aabbccddeeff';

  it('is deterministic for a fixed timestamp', () => {
    const a = generateToken(session, 972501234567, TokenType.SECONDARY, 1_700_000_000);
    const b = generateToken(session, 972501234567, TokenType.SECONDARY, 1_700_000_000);
    assert.equal(a, b);
    assert.equal(a.length, 46);
    assert.equal(a.startsWith('21'), true);
  });

  it('uses a different prefix per token type', () => {
    const sms = generateToken(session, 972501234567, TokenType.SMS, 1_700_000_000);
    const primary = generateToken(
      session,
      972501234567,
      TokenType.PRIMARY,
      1_700_000_000,
    );
    assert.equal(sms.startsWith('01'), true);
    assert.equal(primary.startsWith('11'), true);
  });

  it('rejects a short session token', () => {
    assert.throws(() => generateToken('aa', 1, TokenType.SECONDARY, 1));
  });
});
