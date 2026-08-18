import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compactSystemsGatesStack } from '../src/navigation/hubStack';

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
