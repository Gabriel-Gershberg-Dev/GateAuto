import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compactSystemsGatesStack,
  hubRoutesAfterInvite,
} from '../src/navigation/hubStack';
import { initialHubRoute } from '../src/data/vaultRecoverLogic';

describe('systems ↔ gates stack', () => {
  it('keeps one GatesList and one GateSystems, latest visit wins', () => {
    const next = compactSystemsGatesStack([
      { name: 'GatesList' },
      { name: 'Settings' },
      { name: 'GateSystems' },
      { name: 'GatesList' },
    ]);
    assert.deepEqual(
      next.map((r) => r.name),
      ['Settings', 'GateSystems', 'GatesList'],
    );
  });

  it('does not loop when bouncing hub screens', () => {
    const next = compactSystemsGatesStack([
      { name: 'GatesList' },
      { name: 'GateSystems' },
      { name: 'GatesList' },
      { name: 'GateSystems' },
      { name: 'GatesList' },
    ]);
    assert.deepEqual(
      next.map((r) => r.name),
      ['GateSystems', 'GatesList'],
    );
  });

  it('leaves Systems under Gates so back returns once', () => {
    const next = compactSystemsGatesStack([
      { name: 'GateSystems' },
      { name: 'GatesList' },
    ]);
    assert.deepEqual(
      next.map((r) => r.name),
      ['GateSystems', 'GatesList'],
    );
  });
});

describe('hubRoutesAfterInvite', () => {
  it('opens Gates as root when gates exist and systems are empty', () => {
    assert.deepEqual(
      hubRoutesAfterInvite({ gateCount: 2, systemCount: 0 }).map((r) => r.name),
      ['GatesList'],
    );
  });

  it('keeps Systems under Gates so back returns once', () => {
    assert.deepEqual(
      hubRoutesAfterInvite({ gateCount: 1, systemCount: 1 }).map((r) => r.name),
      ['GateSystems', 'GatesList'],
    );
  });

  it('stays on systems only when there are no gates', () => {
    assert.deepEqual(
      hubRoutesAfterInvite({ gateCount: 0, systemCount: 0 }).map((r) => r.name),
      ['GateSystems'],
    );
  });
});

describe('initialHubRoute pending invites', () => {
  it('opens Gates when a pending invite is waiting and the vault is empty', () => {
    assert.equal(
      initialHubRoute({
        gateCount: 0,
        systemCount: 0,
        pendingInviteCount: 1,
      }),
      'GatesList',
    );
  });
});
