import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { loadCredentials } from '../../data/credentials';
import { appendEvent } from '../../data/eventLog';
import {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_COOLDOWN_SECONDS,
  displayGateName,
  getGate,
  upsertGate,
  type GateBluetoothDevice,
  type GateConfig,
} from '../../data/gatesStore';
import {
  tryGetBtPickerDevices,
  trySyncGeofences,
  type ConnectedBtDevice,
} from '../../integrations/optionalNative';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { openGate, PalGateApiError } from '../../palgate/api';
import { BusySheet, ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { GateLocationPicker } from '../components/GateLocationPicker';
import { hasGoogleMapsApiKey } from '../components/GateMap';
import { RadiusSlider } from '../components/RadiusSlider';
import { StreetViewSheet } from '../components/StreetViewSheet';
import { IconPin } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'GateEditor'>;

function parseCoord(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function pinsEqual(
  aLat: number | null,
  aLng: number | null,
  bLat: number | null,
  bLng: number | null,
): boolean {
  if (aLat == null || aLng == null || bLat == null || bLng == null) {
    return aLat === bLat && aLng === bLng;
  }
  return Math.abs(aLat - bLat) < 1e-5 && Math.abs(aLng - bLng) < 1e-5;
}

function editorKey(g: GateConfig): string {
  return JSON.stringify({
    nameOverride: g.nameOverride,
    lat: g.lat,
    lng: g.lng,
    radiusMeters: g.radiusMeters,
    cooldownMs: g.cooldownMs,
    bluetooth: g.bluetooth,
  });
}

function deviceRowKey(
  device: ConnectedBtDevice | GateBluetoothDevice,
  index: number,
): string {
  return (
    ('address' in device ? device.address?.trim() : '') ||
    ('id' in device ? device.id?.trim() : '') ||
    `${device.name ?? 'device'}-${index}`
  );
}

function normalizeBtAddress(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/-/g, ':');
}

function normalizeBtName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isSameBtDevice(
  a: GateBluetoothDevice,
  b: GateBluetoothDevice,
): boolean {
  const addrA = normalizeBtAddress(a.address);
  const addrB = normalizeBtAddress(b.address);
  if (addrA && addrB) return addrA === addrB;
  const nameA = normalizeBtName(a.name);
  const nameB = normalizeBtName(b.name);
  return Boolean(nameA && nameB && nameA === nameB);
}

function toGateBtDevice(device: ConnectedBtDevice): GateBluetoothDevice | null {
  const name = device.name?.trim() || undefined;
  const address =
    device.address?.trim() ||
    (device.id?.includes(':') ? device.id.trim() : undefined) ||
    undefined;
  if (!name && !address) return null;
  return {
    ...(name ? { name } : {}),
    ...(address ? { address } : {}),
  };
}

export function GateEditorScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { gateId } = route.params;
  const [gate, setGate] = useState<GateConfig | null>(null);
  const [name, setName] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [radiusMeters, setRadiusMeters] = useState(50);
  const [cooldownSeconds, setCooldownSeconds] = useState(DEFAULT_COOLDOWN_SECONDS);
  const [btRequired, setBtRequired] = useState(false);
  const [btDevices, setBtDevices] = useState<GateBluetoothDevice[]>([]);
  const [btPickerOpen, setBtPickerOpen] = useState(false);
  const [btPickerLoading, setBtPickerLoading] = useState(false);
  const [btConnected, setBtConnected] = useState<ConnectedBtDevice[]>([]);
  const [btBonded, setBtBonded] = useState<ConnectedBtDevice[]>([]);
  const [testing, setTesting] = useState(false);
  const [testFlash, setTestFlash] = useState<'Opened' | 'Failed' | null>(null);
  const [mapNonce, setMapNonce] = useState(0);
  const [pendingPin, setPendingPin] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );
  const [confirmStreetView, setConfirmStreetView] = useState(false);
  const [mapGrabbed, setMapGrabbed] = useState(false);
  const mapsEnabled = hasGoogleMapsApiKey();
  const savedRef = useRef<GateConfig | null>(null);
  const readyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const g = await getGate(gateId);
      if (!g) {
        setInfo({
          title: 'Gate not found',
          message: 'Returning to the list.',
        });
        navigation.goBack();
        return;
      }
      setGate(g);
      setName(g.nameOverride?.trim() || g.name);
      setLat(g.lat);
      setLng(g.lng);
      setLatText(g.lat != null ? String(g.lat) : '');
      setLngText(g.lng != null ? String(g.lng) : '');
      setRadiusMeters(g.radiusMeters);
      setCooldownSeconds(
        Math.max(0, Math.round(g.cooldownMs / 1000)) || DEFAULT_COOLDOWN_SECONDS,
      );
      setBtRequired(g.bluetooth.required);
      setBtDevices(g.bluetooth.devices ?? []);
      savedRef.current = g;
      readyRef.current = true;
    })();
  }, [gateId, navigation]);

  const persistGate = useCallback(async (next: GateConfig, syncGeo: boolean) => {
    const saved = savedRef.current;
    if (saved && editorKey(saved) === editorKey(next)) return;
    await upsertGate(next);
    savedRef.current = next;
    setGate((prev) => (prev ? { ...prev, ...next, name: next.name } : next));
    if (syncGeo) {
      await trySyncGeofences();
    }
    setSaveHint('Saved');
    setTimeout(() => setSaveHint((cur) => (cur === 'Saved' ? null : cur)), 1400);
  }, []);

  const applyPin = (nextLat: number, nextLng: number) => {
    setLat(nextLat);
    setLng(nextLng);
    setLatText(String(nextLat));
    setLngText(String(nextLng));
    const next = buildGate();
    if (!next) return;
    void persistGate({ ...next, lat: nextLat, lng: nextLng }, true);
  };

  const revertPin = () => {
    const saved = savedRef.current;
    if (!saved) return;
    setLat(saved.lat);
    setLng(saved.lng);
    setLatText(saved.lat != null ? String(saved.lat) : '');
    setLngText(saved.lng != null ? String(saved.lng) : '');
    setMapNonce((n) => n + 1);
  };

  const requestPinChange = (nextLat: number, nextLng: number) => {
    const saved = savedRef.current;
    if (!saved) return;
    if (pinsEqual(saved.lat, saved.lng, nextLat, nextLng)) return;
    setPendingPin({ lat: nextLat, lng: nextLng });
  };

  const setCoords = (nextLat: number, nextLng: number) => {
    requestPinChange(nextLat, nextLng);
  };

  const commitLatLngFields = () => {
    const nextLat = parseCoord(latText);
    const nextLng = parseCoord(lngText);
    if (nextLat == null || nextLng == null) return;
    requestPinChange(nextLat, nextLng);
  };

  const useCurrentLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setInfo({
          title: 'Location needed',
          message: 'Allow location to place the gate pin.',
        });
        return;
      }
      const last = await Location.getLastKnownPositionAsync();
      const fresh =
        last != null &&
        Date.now() - last.timestamp < 45_000 &&
        (last.coords.accuracy == null || last.coords.accuracy <= 80);
      const pos = fresh
        ? last
        : await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
      if (!pos) {
        setInfo({
          title: 'Location',
          message: 'Couldn’t read GPS. Try again outdoors.',
        });
        return;
      }
      setCoords(pos.coords.latitude, pos.coords.longitude);
    } catch {
      setInfo({
        title: 'Location',
        message: 'Couldn’t read GPS. Try again outdoors.',
      });
    } finally {
      setLocating(false);
    }
  };

  const addBtDevice = (device: ConnectedBtDevice) => {
    const next = toGateBtDevice(device);
    if (!next) return;
    setBtDevices((prev) => {
      if (prev.some((d) => isSameBtDevice(d, next))) return prev;
      return [...prev, next];
    });
    setBtRequired(true);
    setBtPickerOpen(false);
  };

  const removeBtDevice = (index: number) => {
    setBtDevices((prev) => prev.filter((_, i) => i !== index));
  };

  const openBtPicker = async () => {
    setBtPickerOpen(true);
    setBtPickerLoading(true);
    setBtConnected([]);
    setBtBonded([]);
    try {
      const lists = await tryGetBtPickerDevices();
      setBtConnected(lists.connected);
      setBtBonded(lists.bonded);
      if (lists.connected.length === 0 && lists.bonded.length === 0) {
        Alert.alert(
          'Bluetooth',
          'No connected or previously paired Bluetooth devices found. Connect/pair the car in Android Bluetooth settings and grant Nearby devices permission. (Dev client required for native BT.)',
        );
      }
    } catch {
      Alert.alert(
        'Bluetooth',
        'Car Bluetooth matching is unavailable in this build. Use a development client with native Bluetooth.',
      );
    } finally {
      setBtPickerLoading(false);
    }
  };

  useLayoutEffect(() => {
    if (!gate) return;
    const draft = {
      ...gate,
      nameOverride: (() => {
        const trimmed = name.trim();
        const apiName = gate.name.trim();
        if (!trimmed || trimmed === apiName) return null;
        return trimmed;
      })(),
    };
    navigation.setOptions({
      title: displayGateName(draft),
      headerRight: saveHint
        ? () => <Text style={{ color: colors.muted, fontWeight: '600' }}>{saveHint}</Text>
        : undefined,
    });
  }, [colors.muted, gate, name, navigation, saveHint]);

  const buildGate = useCallback((): GateConfig | null => {
    if (!gate) return null;
    const cooldownMs =
      Math.max(0, Math.round(cooldownSeconds * 1000)) || DEFAULT_COOLDOWN_MS;
    const trimmed = name.trim();
    const apiName = gate.name.trim() || gate.deviceId;
    const nameOverride =
      !trimmed || trimmed === apiName ? null : trimmed;
    return {
      ...gate,
      name: apiName,
      nameOverride,
      lat,
      lng,
      radiusMeters,
      cooldownMs,
      bluetooth: {
        required: btRequired,
        devices: btDevices,
      },
    };
  }, [
    gate,
    name,
    lat,
    lng,
    radiusMeters,
    cooldownSeconds,
    btRequired,
    btDevices,
  ]);

  const persistNonLocation = useCallback(() => {
    if (!readyRef.current) return;
    const next = buildGate();
    const saved = savedRef.current;
    if (!next || !saved) return;
    const withSavedPin = { ...next, lat: saved.lat, lng: saved.lng };
    void persistGate(withSavedPin, true);
  }, [buildGate, persistGate]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistNonLocation(), 450);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [name, radiusMeters, cooldownSeconds, btRequired, btDevices, persistNonLocation]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      persistNonLocation();
    });
    return unsub;
  }, [navigation, persistNonLocation]);

  const onTestOpen = async () => {
    if (!gate) return;
    const credentials = await loadCredentials();
    if (!credentials) {
      Alert.alert('Not linked', 'Link a PalGate account first.');
      return;
    }

    // Test Open bypasses the global safety lock (auto-open only).
    setTesting(true);
    try {
      await openGate(credentials, gate.deviceId);
      const saved = buildGate() ?? gate;
      await upsertGate({
        ...saved,
        lastResult: 'test opened',
        lastOpenedAt: Date.now(),
      });
      await appendEvent({
        kind: 'opened',
        gateId: gate.id,
        message: 'Test open succeeded',
      });
      setTestFlash('Opened');
      setTimeout(() => setTestFlash(null), 1600);
    } catch (e) {
      const message =
        e instanceof PalGateApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Open failed';
      await upsertGate({
        ...(buildGate() ?? gate),
        lastResult: `error: ${message}`,
      });
      await appendEvent({
        kind: 'error',
        gateId: gate.id,
        message: `Test open: ${message}`,
      });
      setTestFlash('Failed');
      setTimeout(() => setTestFlash(null), 1800);
    } finally {
      setTesting(false);
    }
  };

  if (!gate) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const mapLat = pendingPin?.lat ?? lat;
  const mapLng = pendingPin?.lng ?? lng;

  return (
    <View style={styles.editorRoot}>
    <ScrollView
      contentContainerStyle={styles.container}
      scrollEnabled={!mapGrabbed}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>Display name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder={gate.name || 'Gate name'}
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.meta}>
        PalGate name: {gate.name || gate.deviceId}
        {gate.nameOverride?.trim()
          ? ' · custom rename saved'
          : ' · leave blank / match PalGate to use API name'}
      </Text>

      <Text style={styles.section}>Location pin</Text>
      <GateLocationPicker
        lat={mapLat}
        lng={mapLng}
        radiusMeters={radiusMeters}
        latText={latText}
        lngText={lngText}
        onLatText={setLatText}
        onLngText={setLngText}
        onCommitFields={commitLatLngFields}
        onProposePin={setCoords}
        onUseCurrentLocation={() => void useCurrentLocation()}
        locating={locating}
        mapsEnabled={mapsEnabled}
        mapNonce={mapNonce}
        onGestureLock={setMapGrabbed}
      />

      <RadiusSlider value={radiusMeters} onChange={setRadiusMeters} />

      <Text style={styles.section}>Car Bluetooth (optional)</Text>
      <View style={styles.rowBetween}>
        <Text style={styles.label}>Require car Bluetooth</Text>
        <Switch
          value={btRequired}
          onValueChange={setBtRequired}
          trackColor={{ false: colors.border, true: colors.primaryMuted }}
          thumbColor={btRequired ? colors.primary : colors.switchThumbOff}
        />
      </View>
      <Text style={styles.meta}>
        Any of these devices (OR) — auto-open if at least one is connected.
      </Text>

      {btRequired && (
        <>
          {btDevices.length === 0 ? (
            <Text style={styles.meta}>
              No devices yet. Add at least one car, or auto-open will skip
              (Bluetooth required).
            </Text>
          ) : (
            btDevices.map((device, index) => (
              <View
                key={`sel-${deviceRowKey(device, index)}`}
                style={styles.selectedDeviceRow}
              >
                <View style={styles.selectedDeviceInfo}>
                  <Text style={styles.deviceName}>
                    {device.name?.trim() || 'Bluetooth device'}
                  </Text>
                  <Text style={styles.deviceAddress}>
                    {device.address?.trim() || '—'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => removeBtDevice(index)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove Bluetooth device"
                >
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
            ))
          )}

          <Pressable
            style={styles.buttonSecondary}
            onPress={() => void openBtPicker()}
          >
            <Text style={styles.buttonSecondaryText}>Add device</Text>
          </Pressable>
        </>
      )}

      {btRequired && btPickerOpen && (
        <View style={styles.pickerBox}>
          {btPickerLoading ? (
            <View style={styles.pickerLoading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.meta}>Loading Bluetooth devices…</Text>
            </View>
          ) : (
            <>
              <Text style={styles.pickerSection}>Connected now</Text>
              {btConnected.length === 0 ? (
                <Text style={styles.meta}>None connected right now</Text>
              ) : (
                btConnected.map((device, index) => (
                  <Pressable
                    key={`c-${deviceRowKey(device, index)}`}
                    style={styles.deviceRow}
                    onPress={() => addBtDevice(device)}
                  >
                    <Text style={styles.deviceName}>
                      {device.name?.trim() || 'Bluetooth device'}
                    </Text>
                    <Text style={styles.deviceAddress}>
                      {device.address?.trim() || device.id?.trim() || '—'}
                    </Text>
                  </Pressable>
                ))
              )}

              <Text style={[styles.pickerSection, styles.pickerSectionSpaced]}>
                Previously paired
              </Text>
              {btBonded.length === 0 ? (
                <Text style={styles.meta}>No other paired devices</Text>
              ) : (
                btBonded.map((device, index) => (
                  <Pressable
                    key={`b-${deviceRowKey(device, index)}`}
                    style={styles.deviceRow}
                    onPress={() => addBtDevice(device)}
                  >
                    <Text style={styles.deviceName}>
                      {device.name?.trim() || 'Bluetooth device'}
                    </Text>
                    <Text style={styles.deviceAddress}>
                      {device.address?.trim() || device.id?.trim() || '—'}
                    </Text>
                  </Pressable>
                ))
              )}

              <Pressable
                style={styles.pickerDismiss}
                onPress={() => setBtPickerOpen(false)}
              >
                <Text style={styles.secondaryText}>Hide device list</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      <Text style={styles.section}>Cooldown (seconds)</Text>
      <TextInput
        style={styles.input}
        value={String(cooldownSeconds)}
        onChangeText={(t) =>
          setCooldownSeconds(Number(t.replace(/[^0-9]/g, '')) || 0)
        }
        keyboardType="number-pad"
        placeholder={String(DEFAULT_COOLDOWN_SECONDS)}
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.meta}>
        Wait this long before auto-opening again (default {DEFAULT_COOLDOWN_SECONDS}{' '}
        sec).
      </Text>

      <Pressable
        style={[
          styles.button,
          testing && styles.disabled,
          testFlash === 'Opened' && styles.testOk,
          testFlash === 'Failed' && styles.testFail,
        ]}
        onPress={() => void onTestOpen()}
        disabled={testing}
      >
        <Text style={styles.buttonText}>
          {testing ? 'Opening…' : testFlash ?? 'Test open'}
        </Text>
      </Pressable>

      <Text style={styles.deviceId} selectable>
        Device ID: {gate.deviceId}
      </Text>
    </ScrollView>
    <BusySheet
      visible={locating}
      title="Finding location"
      message="Waiting on GPS. This can take a few seconds outdoors."
    />
    <ConfirmSheet
      visible={pendingPin != null && !confirmStreetView}
      icon={<IconPin color={colors.primary} />}
      title={lat != null && lng != null ? 'Change location?' : 'Use this pin?'}
      message="Auto-open uses this pin. Look at the street first if you want, then keep the current one or switch."
      cancelLabel={lat != null && lng != null ? 'Keep current' : 'Cancel'}
      confirmLabel={lat != null && lng != null ? 'Change' : 'Use pin'}
      extraLabel="Look at the street"
      onExtra={() => setConfirmStreetView(true)}
      onCancel={() => {
        setPendingPin(null);
        setConfirmStreetView(false);
        revertPin();
      }}
      onConfirm={() => {
        if (!pendingPin) return;
        applyPin(pendingPin.lat, pendingPin.lng);
        setPendingPin(null);
        setConfirmStreetView(false);
      }}
    />
    {pendingPin && confirmStreetView ? (
      <StreetViewSheet
        visible
        lat={pendingPin.lat}
        lng={pendingPin.lng}
        confirmLabel="Pin this place"
        onBack={() => setConfirmStreetView(false)}
        onConfirm={(pin) => {
          applyPin(pin.lat, pin.lng);
          setPendingPin(null);
          setConfirmStreetView(false);
          if (pin.source === 'fallback') {
            setInfo({
              title: 'Using the open pin',
              message:
                'Street camera position wasn’t available. The pin is the spot you opened Street View from.',
            });
          }
        }}
      />
    ) : null}
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
    editorRoot: {
      flex: 1,
      backgroundColor: c.background,
    },
    container: {
      padding: spacing.lg,
      gap: spacing.sm,
      backgroundColor: c.background,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: c.background,
    },
    label: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    section: {
      marginTop: spacing.md,
      fontSize: 17,
      fontWeight: '600',
      color: c.text,
    },
    meta: {
      fontSize: 13,
      color: c.muted,
    },
    input: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 16,
      color: c.text,
    },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    button: {
      backgroundColor: c.primary,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.sm,
      alignItems: 'center',
    },
    buttonSecondary: {
      borderColor: c.primary,
      borderWidth: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.sm,
      alignItems: 'center',
    },
    buttonSecondaryText: {
      color: c.primary,
      fontWeight: '600',
    },
    pickerBox: {
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.md,
      backgroundColor: c.surface,
      padding: spacing.md,
      gap: spacing.sm,
    },
    pickerLoading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    pickerSection: {
      fontSize: 14,
      fontWeight: '700',
      color: c.text,
    },
    pickerSectionSpaced: {
      marginTop: spacing.sm,
    },
    deviceRow: {
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: 2,
    },
    selectedDeviceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      backgroundColor: c.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    selectedDeviceInfo: {
      flex: 1,
      gap: 2,
    },
    deviceName: {
      fontSize: 15,
      fontWeight: '600',
      color: c.text,
    },
    deviceAddress: {
      fontSize: 12,
      color: c.muted,
    },
    removeText: {
      color: c.danger,
      fontWeight: '600',
      fontSize: 14,
    },
    pickerDismiss: {
      paddingVertical: spacing.sm,
      alignItems: 'center',
    },
    secondaryText: {
      color: c.primary,
      fontWeight: '600',
    },
    primary: {
      backgroundColor: c.primary,
      paddingVertical: spacing.md,
      borderRadius: radii.md,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    buttonText: {
      color: c.primaryOn,
      fontWeight: '600',
    },
    disabled: {
      opacity: 0.5,
    },
    testOk: {
      backgroundColor: c.success,
    },
    testFail: {
      backgroundColor: c.fail,
    },
    deviceId: {
      marginTop: spacing.md,
      fontSize: 12,
      color: c.muted,
    },
  });
}
