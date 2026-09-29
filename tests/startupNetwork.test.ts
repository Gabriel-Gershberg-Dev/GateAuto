import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createStartupGate,
  phaseAfterStartupFailure,
  recoverStartupRead,
  resetStartupNetworkWaiver,
  StartupContinued,
  startupNetworkWaived,
  waiveStartupNetwork,
} from '../src/firebase/startupNetwork';

describe('phaseAfterStartupFailure', () => {
  it('refreshes on the first timeout and asks the user after the next one', () => {
    assert.equal(phaseAfterStartupFailure(1), 'refreshing');
    assert.equal(phaseAfterStartupFailure(2), 'needsRefresh');
    assert.equal(phaseAfterStartupFailure(3), 'needsRefresh');
  });
});

describe('recoverStartupRead', () => {
  it('returns the first read without refreshing', async () => {
    let refreshed = 0;
    const phases: string[] = [];
    const value = await recoverStartupRead({
      read: async () => 'gates',
      refresh: async () => {
        refreshed += 1;
      },
      onPhase: (phase) => phases.push(phase),
    });
    assert.equal(value, 'gates');
    assert.equal(refreshed, 0);
    assert.deepEqual(phases, []);
  });

  it('refreshes a hung read once, then returns the next result', async () => {
    let calls = 0;
    let refreshed = 0;
    const phases: string[] = [];
    const value = await recoverStartupRead({
      timeoutMs: 40,
      read: () => {
        calls += 1;
        if (calls === 1) return new Promise(() => undefined);
        return Promise.resolve('open');
      },
      refresh: async () => {
        refreshed += 1;
      },
      onPhase: (phase) => phases.push(phase),
    });
    assert.equal(value, 'open');
    assert.equal(refreshed, 1);
    assert.deepEqual(phases, ['refreshing']);
  });

  it('asks for a connection reset after the automatic refresh still hangs', async () => {
    let calls = 0;
    const phases: string[] = [];
    const value = await recoverStartupRead({
      timeoutMs: 30,
      retryGapMs: 1,
      read: () => {
        calls += 1;
        if (calls < 3) return new Promise(() => undefined);
        return Promise.resolve('done');
      },
      refresh: async () => undefined,
      onPhase: (phase) => phases.push(phase),
    });
    assert.equal(value, 'done');
    assert.deepEqual(phases, ['refreshing', 'needsRefresh']);
  });

  it('opens anyway when continue is signaled during the wait', async () => {
    const gate = createStartupGate();
    const pending = recoverStartupRead({
      timeoutMs: 20,
      retryGapMs: 5_000,
      read: () => new Promise(() => undefined),
      refresh: async () => undefined,
      isStopped: gate.isStopped,
      onPhase: () => undefined,
      wait: gate.wait,
    });
    setTimeout(() => gate.continue(), 80);
    await assert.rejects(pending, StartupContinued);
  });

  it('skips the pause when Refresh is tapped', async () => {
    const gate = createStartupGate();
    let calls = 0;
    const started = Date.now();
    const value = await recoverStartupRead({
      timeoutMs: 20,
      retryGapMs: 5_000,
      read: () => {
        calls += 1;
        if (calls < 3) return new Promise(() => undefined);
        return Promise.resolve('kicked');
      },
      refresh: async () => undefined,
      isStopped: gate.isStopped,
      onPhase: (phase) => {
        if (phase === 'needsRefresh') gate.kick();
      },
      wait: gate.wait,
    });
    assert.equal(value, 'kicked');
    assert.ok(Date.now() - started < 2_000);
  });
});

describe('startup network waiver', () => {
  it('stays waived until the next sign-in resets it', () => {
    resetStartupNetworkWaiver();
    assert.equal(startupNetworkWaived(), false);
    waiveStartupNetwork();
    assert.equal(startupNetworkWaived(), true);
    resetStartupNetworkWaiver();
    assert.equal(startupNetworkWaived(), false);
  });
});
