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
  removeGates,
  type GateConfig,
} from '../../data/gatesStore';
import { listLinkedSystems, listSystems, pruneUnusedSharedSystems } from '../../data/palgateSystems';
import {
  filterDevicesForSystem,
  shouldRefreshPalGateCatalog,
  stripLeakedPalGateCatalog,
} from '../../data/sharedCatalog';
import {
  clearAllSafetyLocks,
  getActiveLocks,
} from '../../data/openSafetyLock';
import { trySyncGeofences } from '../../integrations/optionalNative';
import {
  listIncomingPendingInvites,
  syncRevokedShares,
  type InviteDoc,
} from '../../share/invites';
import { importNativeOpenEvents } from '../../platform/keepAliveAlarm';
import { goToGateSystems } from '../../navigation/hubNavigation';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { getDevices, openGate, PalGateApiError } from '../../palgate/api';
import { BarrierMark } from '../components/BarrierMark';
import { ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { GateRow, type GateOpenFlash } from '../components/GateRow';
import { IncomingInvites } from '../components/IncomingInvites';
import { HeaderIconButton, NavHeader } from '../components/NavHeader';
import { IconLog, IconRefresh, IconSettings, IconShare } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';
import { useRtlLayout } from '../../i18n/useRtlLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'GatesList'>;

const CARD_GAP = 10;

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof PalGateApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

export function GatesListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { row, writingDirection } = useRtlLayout();
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
  const [clearLockOpen, setClearLockOpen] = useState(false);
  const [clearingLock, setClearingLock] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [autoOpenMaster, setAutoOpenMaster] = useState(true);
  const [autoOpenBlockedOpen, setAutoOpenBlockedOpen] = useState(false);
  const [selectMode, setSelectMode] = useState<'off' | 'share' | 'remove'>('off');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removeOpen, setRemoveOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );
  const [incoming, setIncoming] = useState<Array<InviteDoc & { code: string }>>(
    [],
  );
  const [disabledGate, setDisabledGate] = useState<GateConfig | null>(null);
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
    const locks = await getActiveLocks(labels);
    const remaining: Record<string, number> = {};
    for (const lock of locks) {
      remaining[lock.gateId] = lock.remainingMs;
    }
    setLockRemainingByGateId(remaining);
    if (locks.length === 0) {
      setSafetyLockBanner(null);
      return;
    }
    if (locks.length === 1) {
      const lock = locks[0];
      const name = labels[lock.gateId]?.trim() ?? '';
      const who = name ? `${name}: ` : '';
      const mins = Math.max(1, Math.ceil(lock.remainingMs / 60_000));
      setSafetyLockBanner(t('safety.lockBanner', { who, mins }));
      return;
    }
    const list = locks
      .map((lock) => {
        const mins = Math.max(1, Math.ceil(lock.remainingMs / 60_000));
        const label = labels[lock.gateId]?.trim() || lock.gateId;
        return t('safety.minsItem', { label, mins });
      })
      .join(' · ');
    setSafetyLockBanner(t('safety.lockBannerMulti', { list }));
  }, [t]);

  const syncNativeRegions = useCallback(async () => {
    await trySyncGeofences();
  }, []);

  const refreshDevices = useCallback(async () => {
    setError(null);
    const [linked, systems, local, pending] = await Promise.all([
      listLinkedSystems(),
      listSystems(),
      loadGates(),
      listIncomingPendingInvites().catch(() => []),
    ]);
    setIncoming(pending);
    try {
      await syncRevokedShares();
    } catch {
      // Offline: keep local rows, including already-disabled shares.
    }
    let merged = stripLeakedPalGateCatalog(await loadGates(), systems);
    if (merged.length === 0 && local.length > 0) {
      merged = local;
    } else if (merged.length !== local.length) {
      await saveGates(merged);
    }

    if (linked.length === 0) {
      setGates(merged);
      if (
        merged.length === 0 &&
        systems.length === 0 &&
        local.length === 0 &&
        pending.length === 0
      ) {
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
        setError(t('gates.noDevices'));
      }
    } catch (e) {
      const local = stripLeakedPalGateCatalog(await loadGates(), systems);
      setGates(local);
      const message =
        e instanceof PalGateApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : t('gates.loadFailed');
      setError(message);
      await appendEvent({
        kind: 'error',
        message: t('gates.refreshEvent', { message }),
      });
    }
  }, [navigation, syncNativeRegions, t]);

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
      header: (props) => (
        <NavHeader
          title={selectMode !== 'off' ? t('gates.selectTitle') : t('gates.title')}
          mark
          onBack={
            props.back ? () => props.navigation.goBack() : undefined
          }
          actions={
            selectMode !== 'off' ? (
              <HeaderIconButton
                wide
                onPress={() => {
                  setSelectMode('off');
                  setSelectedIds(new Set());
                }}
              >
                <Text style={styles.headerActionText}>{t('common.done')}</Text>
              </HeaderIconButton>
            ) : (
              <>
                <HeaderIconButton
                  onPress={() => navigation.navigate('Monitoring')}
                  accessibilityLabel={t('nav.log')}
                >
                  <IconLog color={colors.primary} />
                </HeaderIconButton>
                <HeaderIconButton
                  onPress={() => {
                    if (refreshing || draggingRef.current) return;
                    void (async () => {
                      setRefreshing(true);
                      await refreshDevices();
                      setRefreshing(false);
                    })();
                  }}
                  accessibilityLabel={t('gates.refresh')}
                >
                  {refreshing ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <IconRefresh color={colors.primary} />
                  )}
                </HeaderIconButton>
                <HeaderIconButton
                  onPress={() => navigation.navigate('Settings')}
                  accessibilityLabel={t('common.settings')}
                >
                  <IconSettings color={colors.primary} />
                </HeaderIconButton>
              </>
            )
          }
        />
      ),
    });
  }, [colors.primary, navigation, refreshDevices, refreshing, selectMode, styles, t]);

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
      message: enabled ? t('autoOpen.enabledEvent') : t('autoOpen.disabledEvent'),
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
          message: t('gates.manualOk'),
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
          message: t('gates.manualFail', { message }),
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
    if (gate.shareDisabled) {
      setDisabledGate(gate);
      return;
    }
    if (openingIds.has(gate.id)) return;
    const credentials = await loadCredentialsForGate(gate);
    if (!credentials) {
      setInfo({
        title: t('gates.notLinkedTitle'),
        message: t('gates.notLinkedMsg'),
      });
      return;
    }

    // Manual Open bypasses the global safety lock (auto-open only).
    setOpeningIds((prev) => new Set(prev).add(gate.id));
    try {
      await openGate(credentials, gate.deviceId);
      await persistOpenResult(gate, true, t('gates.openedOk'));
      flashOpen(gate.id, true, t('gates.openedOk'));
    } catch (e) {
      const message = errorMessage(e, t('gates.openFailed'));
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
        <View style={[styles.safetyLockBox, { flexDirection: row }]}>
          <Text style={[styles.safetyLock, { writingDirection, flex: 1 }]}>
            {safetyLockBanner}
          </Text>
          <Pressable
            onPress={() => setClearLockOpen(true)}
            disabled={clearingLock}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('safety.clear')}
          >
            <Text style={styles.safetyClear}>{t('safety.clear')}</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.inviteWrap}>
        <IncomingInvites
          incoming={incoming}
          gates={gates}
          navigation={navigation}
          onReload={() => void loadLocal()}
        />
      </View>
      {selectMode === 'off' && gates.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('gates.share')}
          onPress={() => {
            setSelectMode('share');
            setSelectedIds(new Set());
          }}
          style={({ pressed }) => [
            styles.shareCtl,
            { flexDirection: row },
            pressed && styles.shareCtlPressed,
          ]}
        >
          <IconShare color={colors.primary} size={18} />
          <Text style={[styles.shareCtlText, { writingDirection }]} numberOfLines={1}>
            {t('gates.share')}
          </Text>
        </Pressable>
      ) : null}
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
            <Text style={styles.empty}>{t('gates.empty')}</Text>
            <Pressable
              onPress={() => setSignOutOpen(true)}
              hitSlop={10}
              accessibilityLabel={t('common.logOut')}
              style={({ pressed }) => [styles.emptyLogout, pressed && { opacity: 0.88 }]}
            >
              <Text style={styles.headerActionText}>{t('common.logOut')}</Text>
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
                  selecting={selectMode !== 'off'}
                  selected={selectedIds.has(item.id)}
                  onPress={() => {
                    if (selectMode !== 'off') {
                      if (selectMode === 'share' && item.shareDisabled) return;
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                      return;
                    }
                    if (item.shareDisabled) {
                      setDisabledGate(item);
                      return;
                    }
                    navigation.navigate('GateEditor', { gateId: item.id });
                  }}
                  onLongPress={() => {
                    if (draggingRef.current) return;
                    if (selectMode === 'off') {
                      setSelectMode('remove');
                      setSelectedIds(new Set([item.id]));
                      return;
                    }
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    });
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
      {selectMode === 'share' && selectedIds.size > 0 ? (
        <Pressable
          style={({ pressed }) => [styles.shareBar, pressed && { opacity: 0.9 }]}
          onPress={() => {
            if (!user?.isRealAccount) {
              setUpgradeOpen(true);
              return;
            }
            const ids = [...selectedIds];
            setSelectMode('off');
            setSelectedIds(new Set());
            navigation.navigate('ShareGate', { gateIds: ids });
          }}
        >
          <Text style={styles.shareBarText}>
            {t('gates.shareBar', { count: selectedIds.size })}
          </Text>
        </Pressable>
      ) : null}
      {selectMode === 'remove' && selectedIds.size > 0 ? (
        <Pressable
          style={({ pressed }) => [styles.removeBar, pressed && { opacity: 0.9 }]}
          onPress={() => setRemoveOpen(true)}
        >
          <Text style={styles.removeBarText}>
            {t('gates.removeBar', { count: selectedIds.size })}
          </Text>
        </Pressable>
      ) : null}
      <ConfirmSheet
        visible={disabledGate != null}
        title={t('gates.shareDisabledTitle')}
        message={t('gates.shareDisabledMsg')}
        cancelLabel={t('common.keep')}
        confirmLabel={t('common.remove')}
        destructive
        onCancel={() => setDisabledGate(null)}
        onConfirm={() => {
          const gate = disabledGate;
          setDisabledGate(null);
          if (!gate) return;
          void (async () => {
            const next = await removeGates([gate.id]);
            await pruneUnusedSharedSystems();
            setGates(next);
            await syncNativeRegions();
          })();
        }}
      />
      <ConfirmSheet
        visible={removeOpen}
        title={t('gates.removeTitle')}
        message={t('gates.removeMsg')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('gates.removeBar', { count: selectedIds.size })}
        destructive
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => {
          const ids = [...selectedIds];
          setRemoveOpen(false);
          setSelectMode('off');
          setSelectedIds(new Set());
          void (async () => {
            const next = await removeGates(ids);
            await pruneUnusedSharedSystems();
            setGates(next);
            await syncNativeRegions();
            await appendEvent({
              kind: 'info',
              message: t('gates.removedEvent'),
            });
          })();
        }}
      />
      <ConfirmSheet
        visible={signOutOpen}
        title={t('account.logOutTitle')}
        message={t('account.signOutMsg')}
        cancelLabel={t('common.staySignedIn')}
        confirmLabel={t('common.logOut')}
        destructive
        onCancel={() => setSignOutOpen(false)}
        onConfirm={() => {
          setSignOutOpen(false);
          void auth.signOut();
        }}
      />
      <ConfirmSheet
        visible={upgradeOpen}
        title={t('gates.shareNeedsAccount')}
        message={t('gates.shareNeedsAccountMsg')}
        cancelLabel={t('common.notNow')}
        confirmLabel={t('common.upgrade')}
        onCancel={() => setUpgradeOpen(false)}
        onConfirm={() => {
          setUpgradeOpen(false);
          navigation.navigate('Settings');
        }}
      />
      <ConfirmSheet
        visible={clearLockOpen}
        title={t('safety.clearTitle')}
        message={t('safety.clearMsg')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('safety.clearConfirm')}
        onCancel={() => setClearLockOpen(false)}
        onConfirm={() => {
          setClearLockOpen(false);
          setClearingLock(true);
          void (async () => {
            try {
              await clearAllSafetyLocks();
              await refreshSafetyLockBanner();
            } finally {
              setClearingLock(false);
            }
          })();
        }}
      />
      <ConfirmSheet
        visible={autoOpenBlockedOpen}
        title={t('autoOpen.blockedTitle')}
        message={t('autoOpen.blockedMsg')}
        cancelLabel={t('common.notNow')}
        confirmLabel={t('autoOpen.openSettings')}
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
    inviteWrap: {
      paddingHorizontal: spacing.md,
      paddingTop: 8,
      gap: 8,
    },
    safetyLockBox: {
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.warningBg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    safetyLock: {
      color: c.warning,
      fontSize: 13,
      fontWeight: '600',
    },
    safetyClear: {
      color: c.primary,
      fontSize: 13,
      fontWeight: '700',
    },
    headerActionText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 15,
    },
    shareCtl: {
      marginHorizontal: spacing.md,
      marginTop: 8,
      marginBottom: 4,
      minHeight: 40,
      paddingHorizontal: 14,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: c.primary,
      backgroundColor: c.primaryMuted,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    shareCtlPressed: {
      opacity: 0.88,
    },
    shareCtlText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 14,
      letterSpacing: -0.2,
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
    removeBar: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      height: 48,
      borderRadius: radii.pill,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeBarText: {
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 15,
    },
  });
}
