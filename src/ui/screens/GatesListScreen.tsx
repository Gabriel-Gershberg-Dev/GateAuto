import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../auth/AuthProvider';
import { loadCredentialsForGate } from '../../data/credentials';
import { appendEvent } from '../../data/eventLog';
import { moveToIndex } from '../../data/gateOrder';
import {
  displayGateName,
  isMonitoringEnabled,
  loadGates,
  mergeDevicesIntoGates,
  parseDevicesResponse,
  saveGates,
  setGateEnabled,
  upsertGate,
  type GateConfig,
} from '../../data/gatesStore';
import { listLinkedSystems, listSystems } from '../../data/palgateSystems';
import {
  filterDevicesForSystem,
  shouldRefreshPalGateCatalog,
  stripLeakedPalGateCatalog,
} from '../../data/sharedCatalog';
import {
  getActiveLocks,
  getActiveLocksBanner,
} from '../../data/openSafetyLock';
import { trySyncGeofences } from '../../integrations/optionalNative';
import { importNativeOpenEvents } from '../../platform/keepAliveAlarm';
import { goToGateSystems } from '../../navigation/hubNavigation';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { getDevices, openGate, PalGateApiError } from '../../palgate/api';
import { BarrierMark } from '../components/BarrierMark';
import { ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { GateRow, type GateOpenFlash } from '../components/GateRow';
import { IconLog, IconRefresh, IconSettings, IconShare } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'GatesList'>;

const CARD_GAP = 10;

function errorMessage(e: unknown): string {
  if (e instanceof PalGateApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Open failed';
}

export function GatesListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const auth = useAuth();
  const { user } = auth;
  const [gates, setGates] = useState<GateConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingIds, setOpeningIds] = useState<Set<string>>(new Set());
  const [openFlashById, setOpenFlashById] = useState<
    Record<string, GateOpenFlash>
  >({});
  const [safetyLockBanner, setSafetyLockBanner] = useState<string | null>(null);
  const [lockRemainingByGateId, setLockRemainingByGateId] = useState<
    Record<string, number>
  >({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [autoOpenMaster, setAutoOpenMaster] = useState(true);
  const [autoOpenBlockedOpen, setAutoOpenBlockedOpen] = useState(false);
  const [shareMode, setShareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );
  const persistChain = useRef(Promise.resolve());
  const listRef = useRef<ScrollView>(null);
  const draggingRef = useRef(false);
  const gatesRef = useRef(gates);
  gatesRef.current = gates;
  const workingRef = useRef(gates);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragScale = useRef(new Animated.Value(1)).current;
  const slotAnims = useRef(new Map<string, Animated.Value>()).current;
  const pendingCommit = useRef(false);
  const dragSession = useRef({
    id: null as string | null,
    startIndex: 0,
    targetIndex: 0,
    heights: {} as Record<string, number>,
    dirty: false,
  });

  const slotAnim = (id: string) => {
    let value = slotAnims.get(id);
    if (!value) {
      value = new Animated.Value(0);
      slotAnims.set(id, value);
    }
    return value;
  };

  const refreshSafetyLockBanner = useCallback(async () => {
    await importNativeOpenEvents();
    const local = await loadGates();
    const labels: Record<string, string> = {};
    for (const g of local) {
      labels[g.id] = displayGateName(g);
    }
    const [banner, locks] = await Promise.all([
      getActiveLocksBanner(labels),
      getActiveLocks(labels),
    ]);
    setSafetyLockBanner(banner);
    const remaining: Record<string, number> = {};
    for (const lock of locks) {
      remaining[lock.gateId] = lock.remainingMs;
    }
    setLockRemainingByGateId(remaining);
  }, []);

  const syncNativeRegions = useCallback(async () => {
    await trySyncGeofences();
  }, []);

  const refreshDevices = useCallback(async () => {
    setError(null);
    const [linked, systems, local] = await Promise.all([
      listLinkedSystems(),
      listSystems(),
      loadGates(),
    ]);
    let merged = stripLeakedPalGateCatalog(local, systems);
    if (merged.length !== local.length) {
      await saveGates(merged);
    }

    if (linked.length === 0) {
      setGates(merged);
      if (merged.length === 0 && systems.length === 0) {
        goToGateSystems(navigation);
        return;
      }
      await syncNativeRegions();
      return;
    }

    try {
      for (const sys of linked) {
        if (!shouldRefreshPalGateCatalog(sys)) continue;
        const raw = await getDevices(sys.credentials);
        const devices = filterDevicesForSystem(
          parseDevicesResponse(raw),
          sys,
        );
        merged = await mergeDevicesIntoGates(devices, {
          systemId: sys.id,
          origin: 'linked',
          allowedDeviceIds: sys.allowedDeviceIds,
          adoptNewDevices: true,
        });
      }
      merged = stripLeakedPalGateCatalog(merged, await listSystems());
      await saveGates(merged);
      setGates(merged);
      await syncNativeRegions();
      if (
        linked.length > 0 &&
        merged.filter((g) => g.origin !== 'shared').length === 0
      ) {
        setError('No devices returned from PalGate. Pull to refresh.');
      }
    } catch (e) {
      const local = stripLeakedPalGateCatalog(await loadGates(), systems);
      setGates(local);
      const message =
        e instanceof PalGateApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to load devices';
      setError(message);
      await appendEvent({
        kind: 'error',
        message: `Refresh devices: ${message}`,
      });
    }
  }, [navigation, syncNativeRegions]);

  const loadLocal = useCallback(async () => {
    setLoading(true);
    const local = await loadGates();
    setGates(local);
    setLoading(false);
    await refreshDevices();
    setLoading(false);
  }, [refreshDevices]);

  useFocusEffect(
    useCallback(() => {
      void loadLocal();
      void refreshSafetyLockBanner();
      void isMonitoringEnabled().then(setAutoOpenMaster);
      const id = setInterval(() => {
        void refreshSafetyLockBanner();
      }, 30_000);
      return () => clearInterval(id);
    }, [loadLocal, refreshSafetyLockBanner]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <BarrierMark brand size={22} />
          <Text style={styles.headerTitleText}>
            {shareMode ? 'Select gates' : 'Gates'}
          </Text>
        </View>
      ),
      headerRight: () =>
        shareMode ? (
          <Pressable
            onPress={() => {
              setShareMode(false);
              setSelectedIds(new Set());
            }}
            hitSlop={10}
            style={styles.headerIcon}
          >
            <Text style={styles.headerActionText}>Done</Text>
          </Pressable>
        ) : (
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => {
                setShareMode(true);
                setSelectedIds(new Set());
              }}
              hitSlop={10}
              accessibilityLabel="Share gates"
              style={styles.headerIcon}
            >
              <IconShare color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Monitoring')}
              hitSlop={10}
              accessibilityLabel="Log"
              style={styles.headerIcon}
            >
              <IconLog color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => {
                if (refreshing || draggingRef.current) return;
                void (async () => {
                  setRefreshing(true);
                  await refreshDevices();
                  setRefreshing(false);
                })();
              }}
              hitSlop={10}
              accessibilityLabel="Refresh"
              style={styles.headerIcon}
            >
              {refreshing ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <IconRefresh color={colors.primary} />
              )}
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Settings')}
              hitSlop={10}
              accessibilityLabel="Settings"
              style={styles.headerIcon}
            >
              <IconSettings color={colors.primary} />
            </Pressable>
          </View>
        ),
    });
  }, [colors.primary, navigation, refreshDevices, refreshing, shareMode, styles]);

  const flashOpen = useCallback(
    (gateId: string, success: boolean, message: string) => {
      setOpenFlashById((prev) => ({
        ...prev,
        [gateId]: { kind: success ? 'success' : 'fail', nonce: Date.now(), message },
      }));
    },
    [],
  );

  const onToggle = async (gate: GateConfig, enabled: boolean) => {
    const next = await setGateEnabled(gate.id, enabled);
    setGates(next);
      await syncNativeRegions();
    await appendEvent({
      kind: 'info',
      gateId: gate.id,
      message: enabled ? 'Auto-open enabled' : 'Auto-open disabled',
    });
  };

  const springTo = (value: Animated.Value, toValue: number) => {
    Animated.spring(value, {
      toValue,
      useNativeDriver: true,
      friction: 10,
      tension: 76,
      overshootClamping: true,
    }).start();
  };

  const layoutNeighbors = (startIndex: number, targetIndex: number, dragId: string) => {
    const dragH = (dragSession.current.heights[dragId] || 80) + CARD_GAP;
    for (const gate of workingRef.current) {
      if (gate.id === dragId) continue;
      const i = workingRef.current.findIndex((g) => g.id === gate.id);
      let dest = 0;
      if (startIndex < targetIndex && i > startIndex && i <= targetIndex) {
        dest = -dragH;
      } else if (startIndex > targetIndex && i < startIndex && i >= targetIndex) {
        dest = dragH;
      }
      springTo(slotAnim(gate.id), dest);
    }
  };

  const onReorderGrant = useCallback(
    (id: string) => {
      const idx = gatesRef.current.findIndex((g) => g.id === id);
      if (idx < 0) return;
      workingRef.current = gatesRef.current.slice();
      dragSession.current.id = id;
      dragSession.current.startIndex = idx;
      dragSession.current.targetIndex = idx;
      dragSession.current.dirty = false;
      dragY.setValue(0);
      dragScale.setValue(1);
      for (const gate of workingRef.current) {
        slotAnim(gate.id).setValue(0);
      }
      springTo(dragScale, 1.02);
      draggingRef.current = true;
      listRef.current?.setNativeProps({ scrollEnabled: false });
      setDraggingId(id);
    },
    [dragScale, dragY],
  );

  const onReorderMove = useCallback(
    (id: string, dy: number) => {
      const session = dragSession.current;
      if (session.id !== id) return;
      dragY.setValue(dy);
      const h = (session.heights[id] || 80) + CARD_GAP;
      const n = workingRef.current.length;
      const target = Math.max(
        0,
        Math.min(n - 1, session.startIndex + Math.round(dy / h)),
      );
      if (target === session.targetIndex) return;
      session.targetIndex = target;
      session.dirty = target !== session.startIndex;
      layoutNeighbors(session.startIndex, target, id);
    },
    [dragY],
  );

  const onReorderRelease = useCallback(() => {
    const session = dragSession.current;
    const id = session.id;
    const ordered = id
      ? moveToIndex(workingRef.current, id, session.targetIndex)
      : workingRef.current;
    const dirty = session.dirty;
    session.id = null;
    workingRef.current = ordered;
    pendingCommit.current = true;
    draggingRef.current = false;
    listRef.current?.setNativeProps({ scrollEnabled: true });
    setDraggingId(null);
    if (!dirty || !id) return;
    setGates(ordered);
    void saveGates(ordered);
  }, []);

  useLayoutEffect(() => {
    if (draggingId != null) return;
    if (!pendingCommit.current) return;
    pendingCommit.current = false;
    dragY.setValue(0);
    dragScale.setValue(1);
    for (const gate of gatesRef.current) {
      slotAnim(gate.id).setValue(0);
    }
  }, [draggingId, dragScale, dragY, gates]);

  const persistOpenResult = (gate: GateConfig, success: boolean, message: string) => {
    const run = async () => {
      if (success) {
        const next = await upsertGate({
          ...gate,
          lastResult: 'opened',
          lastOpenedAt: Date.now(),
        });
        setGates(next);
        await appendEvent({
          kind: 'opened',
          gateId: gate.id,
          message: 'Manual open succeeded',
        });
      } else {
        const next = await upsertGate({
          ...gate,
          lastResult: `error: ${message}`,
        });
        setGates(next);
        await appendEvent({
          kind: 'error',
          gateId: gate.id,
          message: `Manual open: ${message}`,
        });
      }
    };
    const queued = persistChain.current.then(run, run);
    persistChain.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };

  const onOpen = async (gate: GateConfig) => {
    if (openingIds.has(gate.id)) return;
    const credentials = await loadCredentialsForGate(gate);
    if (!credentials) {
      setInfo({
        title: 'Not linked',
        message: 'Link a PalGate account first from Gate systems.',
      });
      return;
    }

    // Manual Open bypasses the global safety lock (auto-open only).
    setOpeningIds((prev) => new Set(prev).add(gate.id));
    try {
      await openGate(credentials, gate.deviceId);
      await persistOpenResult(gate, true, 'Opened successfully');
      flashOpen(gate.id, true, 'Opened successfully');
    } catch (e) {
      const message = errorMessage(e);
      await persistOpenResult(gate, false, message);
      flashOpen(gate.id, false, message);
    } finally {
      setOpeningIds((prev) => {
        const next = new Set(prev);
        next.delete(gate.id);
        return next;
      });
    }
  };

  if (loading && gates.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {safetyLockBanner ? (
        <Text style={styles.safetyLock}>{safetyLockBanner}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView
        ref={listRef}
        scrollEnabled={draggingId == null}
        nestedScrollEnabled={false}
        overScrollMode={draggingId ? 'never' : 'auto'}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            enabled={draggingId == null}
            refreshing={refreshing && draggingId == null}
            onRefresh={() => {
              if (draggingRef.current || draggingId) return;
              void (async () => {
                setRefreshing(true);
                await refreshDevices();
                setRefreshing(false);
              })();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {gates.length === 0 ? (
          <View style={styles.emptyBox}>
            <BarrierMark size={56} color={colors.muted} />
            <Text style={styles.empty}>
              No gates yet. Scan PalGate from Gate systems, or pull to refresh.
            </Text>
            <Pressable
              onPress={() => setSignOutOpen(true)}
              hitSlop={10}
              accessibilityLabel="Log out"
              style={({ pressed }) => [styles.emptyLogout, pressed && { opacity: 0.88 }]}
            >
              <Text style={styles.headerActionText}>Log out</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.stack}>
            {gates.map((item) => (
              <Animated.View
                key={item.id}
                onLayout={(e) => {
                  dragSession.current.heights[item.id] =
                    e.nativeEvent.layout.height;
                }}
                style={[
                  styles.card,
                  draggingId === item.id ? styles.cardLift : null,
                  draggingId === item.id
                    ? {
                        zIndex: 8,
                        transform: [{ translateY: dragY }, { scale: dragScale }],
                      }
                    : {
                        zIndex: 0,
                        transform: [{ translateY: slotAnim(item.id) }],
                      },
                ]}
              >
                <GateRow
                  gate={item}
                  dragging={draggingId === item.id}
                  autoOpenMaster={autoOpenMaster}
                  onAutoOpenBlocked={() => setAutoOpenBlockedOpen(true)}
                  selecting={shareMode}
                  selected={selectedIds.has(item.id)}
                  onPress={() => {
                    if (shareMode) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                      return;
                    }
                    navigation.navigate('GateEditor', { gateId: item.id });
                  }}
                  onShare={() =>
                    navigation.navigate('ShareGate', { gateIds: [item.id] })
                  }
                  onToggleEnabled={(enabled) => void onToggle(item, enabled)}
                  onOpen={() => void onOpen(item)}
                  opening={openingIds.has(item.id)}
                  openFlash={openFlashById[item.id] ?? null}
                  safetyLockRemainingMs={lockRemainingByGateId[item.id] ?? 0}
                  onReorderGrant={() => onReorderGrant(item.id)}
                  onReorderMove={(dy) => onReorderMove(item.id, dy)}
                  onReorderRelease={onReorderRelease}
                />
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>
      {shareMode && selectedIds.size > 0 ? (
        <Pressable
          style={({ pressed }) => [styles.shareBar, pressed && { opacity: 0.9 }]}
          onPress={() => {
            if (!user?.isRealAccount) {
              setUpgradeOpen(true);
              return;
            }
            const ids = [...selectedIds];
            setShareMode(false);
            setSelectedIds(new Set());
            navigation.navigate('ShareGate', { gateIds: ids });
          }}
        >
          <Text style={styles.shareBarText}>
            Share {selectedIds.size} {selectedIds.size === 1 ? 'gate' : 'gates'}
          </Text>
        </Pressable>
      ) : null}
      <ConfirmSheet
        visible={signOutOpen}
        title="Log out?"
        message="Gates stay with this account on this phone. The next sign-in will not see them unless it is this same account."
        cancelLabel="Stay signed in"
        confirmLabel="Log out"
        destructive
        onCancel={() => setSignOutOpen(false)}
        onConfirm={() => {
          setSignOutOpen(false);
          void auth.signOut();
        }}
      />
      <ConfirmSheet
        visible={upgradeOpen}
        title="Sharing needs an account"
        message="Guest can open gates on this phone. To share, sign in with Google or email."
        cancelLabel="Not now"
        confirmLabel="Upgrade"
        onCancel={() => setUpgradeOpen(false)}
        onConfirm={() => {
          setUpgradeOpen(false);
          navigation.navigate('Settings');
        }}
      />
      <ConfirmSheet
        visible={autoOpenBlockedOpen}
        title="Auto-open is off"
        message="Turn Auto-open on in Settings first. Then you can enable Auto on each gate."
        cancelLabel="Not now"
        confirmLabel="Open Settings"
        onCancel={() => setAutoOpenBlockedOpen(false)}
        onConfirm={() => {
          setAutoOpenBlockedOpen(false);
          navigation.navigate('Settings');
        }}
      />
      <InfoSheet
        visible={info != null}
        title={info?.title ?? ''}
        message={info?.message ?? ''}
        onDismiss={() => setInfo(null)}
      />
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: c.background,
    },
    list: {
      padding: spacing.md,
      paddingBottom: spacing.lg,
      flexGrow: 1,
    },
    stack: {
      gap: CARD_GAP,
    },
    card: {
      borderRadius: radii.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      ...Platform.select({
        ios: {
          shadowColor: c.shadow,
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: 3 },
        default: {},
      }),
    },
    cardLift: {
      ...Platform.select({
        ios: {
          shadowOpacity: 0.2,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
        },
        android: { elevation: 12 },
        default: {},
      }),
    },
    empty: {
      color: c.muted,
      fontSize: 16,
      textAlign: 'center',
    },
    emptyBox: {
      alignItems: 'center',
      gap: 14,
      marginTop: spacing.lg,
      paddingHorizontal: spacing.md,
    },
    emptyLogout: {
      paddingVertical: 10,
    },
    error: {
      color: c.danger,
      backgroundColor: c.dangerBg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 13,
    },
    safetyLock: {
      color: c.warning,
      backgroundColor: c.warningBg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 13,
      fontWeight: '600',
    },
    headerTitle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerTitleText: {
      fontSize: 17,
      fontWeight: '600',
      color: c.text,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    headerIcon: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerActionText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 15,
    },
    shareBar: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      height: 48,
      borderRadius: radii.pill,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shareBarText: {
      color: c.primaryOn,
      fontWeight: '700',
      fontSize: 15,
    },
  });
}
