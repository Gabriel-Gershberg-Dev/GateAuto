import AsyncStorage from '@react-native-async-storage/async-storage';
import { hydrateUserScope, scopedAsyncKey } from './userScope';
import type { GateConfig } from './gatesStore';

export type GateList = {
  id: string;
  name: string;
  gateIds: string[];
  expanded: boolean;
};

function listsKey(): string {
  return scopedAsyncKey('gateLists');
}

function cleanId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function normalizeGateList(raw: unknown): GateList | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = cleanId(row.id);
  const gateIds = uniqueIds(
    Array.isArray(row.gateIds)
      ? row.gateIds.map((item) => cleanId(item)).filter(Boolean)
      : [],
  );
  if (!id || gateIds.length === 0) return null;
  const name = cleanId(row.name);
  return {
    id,
    name,
    gateIds,
    expanded: row.expanded !== false,
  };
}

export function normalizeGateLists(raw: unknown): GateList[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const claimed = new Set<string>();
  const out: GateList[] = [];
  for (const item of raw) {
    const list = normalizeGateList(item);
    if (!list || seen.has(list.id)) continue;
    const gateIds = list.gateIds.filter((id) => !claimed.has(id));
    if (gateIds.length === 0) continue;
    for (const id of gateIds) claimed.add(id);
    seen.add(list.id);
    out.push({ ...list, gateIds });
  }
  return out;
}

export function listedGateIds(lists: GateList[]): Set<string> {
  const ids = new Set<string>();
  for (const list of lists) {
    for (const id of list.gateIds) ids.add(id);
  }
  return ids;
}

export function ungroupedGates(
  gates: GateConfig[],
  lists: GateList[],
): GateConfig[] {
  const listed = listedGateIds(lists);
  return gates.filter((gate) => !listed.has(gate.id));
}

export function gatesInList(gates: GateConfig[], list: GateList): GateConfig[] {
  const byId = new Map(gates.map((gate) => [gate.id, gate]));
  const out: GateConfig[] = [];
  for (const id of list.gateIds) {
    const gate = byId.get(id);
    if (gate) out.push(gate);
  }
  return out;
}

export function pruneMissingGates(
  lists: GateList[],
  liveIds: Iterable<string>,
): GateList[] {
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds);
  let changed = false;
  const next: GateList[] = [];
  for (const list of lists) {
    const gateIds = list.gateIds.filter((id) => live.has(id));
    if (gateIds.length === 0) {
      changed = true;
      continue;
    }
    if (gateIds.length !== list.gateIds.length) {
      changed = true;
      next.push({ ...list, gateIds });
    } else {
      next.push(list);
    }
  }
  return changed ? next : lists;
}

export function createGateList(
  lists: GateList[],
  name: string,
  gateIds: Iterable<string>,
  now = Date.now(),
): GateList[] {
  const ids = uniqueIds([...gateIds].map((id) => String(id).trim()));
  if (ids.length === 0) return lists;
  const without = lists
    .map((list) => ({
      ...list,
      gateIds: list.gateIds.filter((id) => !ids.includes(id)),
    }))
    .filter((list) => list.gateIds.length > 0);
  const label = name.trim();
  return [
    ...without,
    {
      id: `list_${now.toString(36)}`,
      name: label,
      gateIds: ids,
      expanded: true,
    },
  ];
}

export function renameGateList(
  lists: GateList[],
  listId: string,
  name: string,
): GateList[] {
  const label = name.trim();
  return lists.map((list) =>
    list.id === listId ? { ...list, name: label } : list,
  );
}

export function toggleGateListExpanded(
  lists: GateList[],
  listId: string,
): GateList[] {
  return lists.map((list) =>
    list.id === listId ? { ...list, expanded: !list.expanded } : list,
  );
}

export function ungroupGateList(lists: GateList[], listId: string): GateList[] {
  return lists.filter((list) => list.id !== listId);
}

/** Move gates onto an existing list. A gate stays in at most one list. */
/** Take gates out of their lists. The gates stay; empty lists drop. */
export function removeGatesFromLists(
  lists: GateList[],
  gateIds: Iterable<string>,
): GateList[] {
  const removing = new Set(
    uniqueIds([...gateIds].map((id) => String(id).trim())),
  );
  if (removing.size === 0) return lists;
  let changed = false;
  const next: GateList[] = [];
  for (const list of lists) {
    const remaining = list.gateIds.filter((id) => !removing.has(id));
    if (remaining.length === list.gateIds.length) {
      next.push(list);
      continue;
    }
    changed = true;
    if (remaining.length === 0) continue;
    next.push({ ...list, gateIds: remaining });
  }
  return changed ? next : lists;
}

export function addGatesToList(
  lists: GateList[],
  listId: string,
  gateIds: Iterable<string>,
): GateList[] {
  const ids = uniqueIds([...gateIds].map((id) => String(id).trim()));
  if (ids.length === 0) return lists;
  if (!lists.some((list) => list.id === listId)) return lists;
  const moving = new Set(ids);
  const next: GateList[] = [];
  for (const list of lists) {
    if (list.id === listId) {
      next.push({
        ...list,
        gateIds: uniqueIds([...list.gateIds, ...ids]),
        expanded: true,
      });
      continue;
    }
    const remaining = list.gateIds.filter((id) => !moving.has(id));
    if (remaining.length === 0) continue;
    next.push(
      remaining.length === list.gateIds.length
        ? list
        : { ...list, gateIds: remaining },
    );
  }
  return next;
}

export function reorderUngrouped(
  all: GateConfig[],
  lists: GateList[],
  orderedUngrouped: GateConfig[],
): GateConfig[] {
  const listed = listedGateIds(lists);
  const queue = orderedUngrouped.slice();
  return all.map((gate) => {
    if (listed.has(gate.id)) return gate;
    return queue.shift() ?? gate;
  });
}

export async function loadGateLists(): Promise<GateList[]> {
  await hydrateUserScope();
  try {
    const raw = await AsyncStorage.getItem(listsKey());
    if (!raw) return [];
    return normalizeGateLists(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveGateLists(lists: GateList[]): Promise<void> {
  await hydrateUserScope();
  const clean = normalizeGateLists(lists);
  await AsyncStorage.setItem(listsKey(), JSON.stringify(clean));
}
