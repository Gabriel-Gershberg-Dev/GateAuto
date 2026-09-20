import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createGateList,
  gatesInList,
  listedGateIds,
  normalizeGateLists,
  pruneMissingGates,
  renameGateList,
  reorderUngrouped,
  toggleGateListExpanded,
  addGatesToList,
  removeGatesFromLists,
  ungroupGateList,
  ungroupedGates,
  type GateList,
} from '../src/data/gateLists';
import type { GateConfig } from '../src/data/gatesStore';

function gate(id: string): GateConfig {
  return {
    id,
    deviceId: id,
    systemId: null,
    origin: 'linked',
    sharedInviteCode: null,
    sharedFromName: null,
    name: id,
    nameOverride: null,
    enabled: true,
    lat: null,
    lng: null,
    radiusMeters: 50,
    cooldownMs: 30_000,
    holdEnabled: false,
    holdMs: 0,
    bluetooth: { required: false, devices: [] },
    lastOpenedAt: null,
    lastResult: null,
  };
}

describe('gate lists', () => {
  it('drops empty, duplicate, and overlapping membership', () => {
    const lists = normalizeGateLists([
      { id: 'a', name: 'Home', gateIds: ['g1', 'g1', 'g2'], expanded: true },
      { id: 'b', name: 'Work', gateIds: ['g2', 'g3'], expanded: false },
      { id: '', name: 'Bad', gateIds: ['g4'] },
      { id: 'c', name: 'Empty', gateIds: [] },
    ]);
    assert.deepEqual(
      lists.map((list) => ({ id: list.id, gateIds: list.gateIds })),
      [
        { id: 'a', gateIds: ['g1', 'g2'] },
        { id: 'b', gateIds: ['g3'] },
      ],
    );
  });

  it('creates a list and moves gates out of an older list', () => {
    const prev: GateList[] = [
      { id: 'old', name: 'Old', gateIds: ['g1', 'g9'], expanded: true },
    ];
    const next = createGateList(prev, '  Home  ', ['g1', 'g2'], 1_700_000_000_000);
    assert.equal(next.length, 2);
    assert.deepEqual(next[0], { id: 'old', name: 'Old', gateIds: ['g9'], expanded: true });
    assert.equal(next[1]?.name, 'Home');
    assert.deepEqual(next[1]?.gateIds, ['g1', 'g2']);
    assert.equal(next[1]?.expanded, true);
    assert.equal(next[1]?.id.startsWith('list_'), true);
  });

  it('prunes missing gates and drops empty lists', () => {
    const lists: GateList[] = [
      { id: 'a', name: 'Home', gateIds: ['g1', 'gone'], expanded: true },
      { id: 'b', name: 'Gone', gateIds: ['gone'], expanded: true },
    ];
    const next = pruneMissingGates(lists, ['g1']);
    assert.deepEqual(next, [
      { id: 'a', name: 'Home', gateIds: ['g1'], expanded: true },
    ]);
    assert.equal(pruneMissingGates(next, ['g1']), next);
  });

  it('splits listed vs ungrouped and keeps list order', () => {
    const gates = [gate('g1'), gate('g2'), gate('g3')];
    const lists: GateList[] = [
      { id: 'a', name: 'Home', gateIds: ['g3', 'g1'], expanded: true },
    ];
    assert.deepEqual([...listedGateIds(lists)], ['g3', 'g1']);
    assert.deepEqual(
      gatesInList(gates, lists[0]!).map((g) => g.id),
      ['g3', 'g1'],
    );
    assert.deepEqual(
      ungroupedGates(gates, lists).map((g) => g.id),
      ['g2'],
    );
  });

  it('renames, expands, and ungroups without deleting gates', () => {
    const lists: GateList[] = [
      { id: 'a', name: 'Home', gateIds: ['g1'], expanded: true },
    ];
    assert.equal(renameGateList(lists, 'a', '  Yard  ')[0]?.name, 'Yard');
    assert.equal(toggleGateListExpanded(lists, 'a')[0]?.expanded, false);
    assert.deepEqual(ungroupGateList(lists, 'a'), []);
  });

  it('adds gates to an existing list and moves them out of another', () => {
    const lists: GateList[] = [
      { id: 'home', name: 'Home', gateIds: ['g1'], expanded: false },
      { id: 'work', name: 'Work', gateIds: ['g2', 'g9'], expanded: true },
    ];
    const next = addGatesToList(lists, 'home', ['g2', 'g3']);
    assert.deepEqual(
      next.map((list) => ({ id: list.id, gateIds: list.gateIds, expanded: list.expanded })),
      [
        { id: 'home', gateIds: ['g1', 'g2', 'g3'], expanded: true },
        { id: 'work', gateIds: ['g9'], expanded: true },
      ],
    );
    assert.equal(addGatesToList(lists, 'missing', ['g3']), lists);
    assert.equal(addGatesToList(lists, 'home', []), lists);
  });

  it('removes gates from a list without deleting them', () => {
    const lists: GateList[] = [
      { id: 'home', name: 'Home', gateIds: ['g1', 'g2'], expanded: true },
      { id: 'work', name: 'Work', gateIds: ['g3'], expanded: true },
    ];
    const next = removeGatesFromLists(lists, ['g1', 'g3', 'gone']);
    assert.deepEqual(
      next.map((list) => ({ id: list.id, gateIds: list.gateIds })),
      [{ id: 'home', gateIds: ['g2'] }],
    );
    assert.equal(removeGatesFromLists(lists, ['g9']), lists);
    assert.equal(removeGatesFromLists(lists, []), lists);
  });

  it('reorders only ungrouped gates', () => {
    const all = [gate('g1'), gate('g2'), gate('g3')];
    const lists: GateList[] = [
      { id: 'a', name: 'Home', gateIds: ['g1'], expanded: true },
    ];
    const next = reorderUngrouped(all, lists, [gate('g3'), gate('g2')]);
    assert.deepEqual(
      next.map((g) => g.id),
      ['g1', 'g3', 'g2'],
    );
  });
});
