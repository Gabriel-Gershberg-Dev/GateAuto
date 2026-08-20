import * as Location from 'expo-location';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../ThemeProvider';
import { formatCoordPair, formatStreetName } from '../streetName';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';
import { GateMap } from './GateMap';
import { PinMapSheet } from './PinMapSheet';
import { StreetViewSheet } from './StreetViewSheet';

const CARD_GAP = 10;
const DEFAULT_LAT = 32.0853;
const DEFAULT_LNG = 34.7818;
const MAP_HEIGHT = 280;

type Mode = 'map' | 'coords';

type Props = {
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  latText: string;
  lngText: string;
  onLatText: (text: string) => void;
  onLngText: (text: string) => void;
  onCommitFields: () => void;
  onProposePin: (lat: number, lng: number) => void;
  onUseCurrentLocation: () => void;
  locating: boolean;
  mapsEnabled: boolean;
  mapNonce: number;
  onGestureLock?: (locked: boolean) => void;
};

async function lookupStreet(lat: number, lng: number): Promise<string> {
  try {
    const places = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lng,
    });
    const name = places[0] ? formatStreetName(places[0]) : '';
    return name;
  } catch {
    return '';
  }
}

async function readGps(): Promise<{ lat: number; lng: number } | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
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
  if (!pos) return null;
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

export function GateLocationPicker({
  lat,
  lng,
  radiusMeters,
  latText,
  lngText,
  onLatText,
  onLngText,
  onCommitFields,
  onProposePin,
  onUseCurrentLocation,
  locating,
  mapsEnabled,
  mapNonce,
  onGestureLock,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState<Mode>(mapsEnabled ? 'map' : 'coords');
  const [streetView, setStreetView] = useState<{
    lat: number;
    lng: number;
    name: string;
  } | null>(null);
  const [savedStreet, setSavedStreet] = useState('');
  const [viewLat, setViewLat] = useState(lat ?? DEFAULT_LAT);
  const [viewLng, setViewLng] = useState(lng ?? DEFAULT_LNG);
  const [query, setQuery] = useState('');
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [fullMap, setFullMap] = useState(false);

  useEffect(() => {
    if (!mapsEnabled && mode === 'map') setMode('coords');
  }, [mapsEnabled, mode]);

  useEffect(() => {
    if (lat != null && lng != null) {
      setViewLat(lat);
      setViewLng(lng);
      return;
    }
    let cancelled = false;
    void readGps().then((gps) => {
      if (cancelled || !gps) return;
      setViewLat(gps.lat);
      setViewLng(gps.lng);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  useEffect(() => {
    const lookLat = lat ?? viewLat;
    const lookLng = lng ?? viewLng;
    let cancelled = false;
    void lookupStreet(lookLat, lookLng).then((name) => {
      if (!cancelled) setSavedStreet(name);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, viewLat, viewLng]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchHint(null);
    try {
      const hits = await Location.geocodeAsync(q);
      const first = hits[0];
      if (!first) {
        setSearchHint(t('map.noMatch'));
        return;
      }
      setViewLat(first.latitude);
      setViewLng(first.longitude);
      onProposePin(first.latitude, first.longitude);
    } catch {
      setSearchHint(t('map.lookupFail'));
    } finally {
      setSearching(false);
    }
  };

  const hasPin = lat != null && lng != null;
  const plaqueName = savedStreet
    ? savedStreet
    : hasPin
      ? t('map.droppedPin')
      : t('map.tapRoad');

  return (
    <View style={styles.wrap}>
      {mapsEnabled ? (
        <View style={styles.segment}>
          {(
            [
              { value: 'map', label: t('map.map') },
              { value: 'coords', label: t('map.coords') },
            ] as const
          ).map((opt) => {
            const selected = mode === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setMode(opt.value)}
              >
                <Text
                  style={[styles.chipText, selected && styles.chipTextSelected]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {mode === 'map' && mapsEnabled ? (
        <>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => void runSearch()}
              placeholder={t('map.findStreet')}
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              autoCorrect={false}
            />
            <Pressable
              onPress={() => void runSearch()}
              style={[styles.searchGo, searching && styles.disabled]}
              disabled={searching}
            >
              {searching ? (
                <ActivityIndicator color={colors.primaryOn} size="small" />
              ) : (
                <Text style={styles.searchGoText}>Go</Text>
              )}
            </Pressable>
          </View>
          {searchHint ? <Text style={styles.searchHint}>{searchHint}</Text> : null}

          <View style={styles.mapCard}>
            <View style={styles.mapBox}>
              <GateMap
                key={mapNonce}
                lat={viewLat}
                lng={viewLng}
                radiusMeters={radiusMeters}
                interactive
                showPin={hasPin}
                showsUserLocation
                onGestureLock={onGestureLock}
                onChange={(nextLat, nextLng) => {
                  setViewLat(nextLat);
                  setViewLng(nextLng);
                  onProposePin(nextLat, nextLng);
                }}
              />
            </View>
            <View style={styles.plaque} pointerEvents="none">
              <View style={styles.plaqueTick} />
              <View style={styles.plaqueCopy}>
                <Text style={styles.plaqueStreet} numberOfLines={1}>
                  {plaqueName}
                </Text>
                <Text style={styles.plaqueCoords}>
                  {hasPin
                    ? formatCoordPair(lat, lng)
                    : t('map.tapHold')}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => setFullMap(true)}
              style={({ pressed }) => [
                styles.fullMapBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.fullMapText}>{t('map.fullMap')}</Text>
            </Pressable>
          </View>

          <View style={styles.row}>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                locating && styles.disabled,
                pressed && styles.pressed,
              ]}
              onPress={onUseCurrentLocation}
              disabled={locating}
            >
              {locating ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Text style={styles.btnGhostText}>My location</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                (!hasPin || pressed) && hasPin && styles.pressed,
                !hasPin && styles.disabled,
              ]}
              disabled={!hasPin}
              onPress={() => {
                if (lat == null || lng == null) return;
                setStreetView({ lat, lng, name: savedStreet });
              }}
            >
              <Text style={styles.btnPrimaryText}>{t('editor.lookStreet')}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          {!mapsEnabled ? (
            <Text style={styles.meta}>
              Pin with GPS or coordinates. Maps need a Google Maps API key in
              this build.
            </Text>
          ) : null}
          <Text style={styles.fieldLabel}>{t('map.lat')}</Text>
          <TextInput
            style={styles.input}
            value={latText}
            onChangeText={onLatText}
            onEndEditing={onCommitFields}
            placeholder="e.g. 32.085300"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            autoCapitalize="none"
          />
          <Text style={styles.fieldLabel}>{t('map.lng')}</Text>
          <TextInput
            style={styles.input}
            value={lngText}
            onChangeText={onLngText}
            onEndEditing={onCommitFields}
            placeholder="e.g. 34.781800"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            autoCapitalize="none"
          />
          <Pressable
            style={[styles.fullBtn, locating && styles.disabled]}
            onPress={onUseCurrentLocation}
            disabled={locating}
          >
            {locating ? (
              <ActivityIndicator color={colors.primaryOn} size="small" />
            ) : (
              <Text style={styles.btnPrimaryText}>{t('map.useCurrent')}</Text>
            )}
          </Pressable>
          {hasPin ? (
            <Pressable
              onPress={() =>
                setStreetView({
                  lat,
                  lng,
                  name: savedStreet,
                })
              }
              style={styles.linkBtn}
            >
              <Text style={styles.linkText}>{t('editor.lookStreet')}</Text>
            </Pressable>
          ) : null}
        </>
      )}

      <PinMapSheet
        visible={fullMap}
        lat={viewLat}
        lng={viewLng}
        radiusMeters={radiusMeters}
        showPin={hasPin}
        streetName={savedStreet}
        onBack={() => setFullMap(false)}
        onConfirm={(nextLat, nextLng) => {
          setViewLat(nextLat);
          setViewLng(nextLng);
          onProposePin(nextLat, nextLng);
          setFullMap(false);
        }}
      />

      {streetView ? (
        <StreetViewSheet
          visible
          lat={streetView.lat}
          lng={streetView.lng}
          streetName={streetView.name}
          confirmLabel={t('editor.pinPlace')}
          onBack={() => setStreetView(null)}
          onConfirm={(pin) => {
            setViewLat(pin.lat);
            setViewLng(pin.lng);
            onProposePin(pin.lat, pin.lng);
            setStreetView(null);
            if (pin.source === 'fallback') {
              setSearchHint(t('map.fallbackHint'));
            }
          }}
        />
      ) : null}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      gap: CARD_GAP,
    },
    segment: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderRadius: radii.sm,
      padding: 3,
      gap: 2,
    },
    chip: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: radii.sm - 2,
      alignItems: 'center',
    },
    chipSelected: {
      backgroundColor: c.background,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.muted,
    },
    chipTextSelected: {
      color: c.text,
    },
    mapCard: {
      borderRadius: radii.md,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    mapBox: {
      height: MAP_HEIGHT,
    },
    plaque: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
    plaqueTick: {
      width: 3,
      borderRadius: 2,
      backgroundColor: c.primary,
      marginVertical: 2,
    },
    plaqueCopy: {
      flex: 1,
      gap: 2,
    },
    plaqueStreet: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: c.text,
    },
    plaqueCoords: {
      fontSize: 12,
      fontFamily: 'monospace',
      color: c.muted,
    },
    fullMapBtn: {
      alignSelf: 'flex-start',
      marginTop: -2,
      paddingHorizontal: 12,
      paddingBottom: 10,
    },
    fullMapText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 14,
    },
    meta: {
      fontSize: 13,
      lineHeight: 18,
      color: c.muted,
    },
    row: {
      flexDirection: 'row',
      gap: CARD_GAP,
    },
    btn: {
      flex: 1,
      height: 44,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnPrimary: {
      backgroundColor: c.primary,
    },
    btnPrimaryText: {
      color: c.primaryOn,
      fontWeight: '700',
      fontSize: 14,
    },
    btnGhost: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    btnGhostText: {
      color: c.text,
      fontWeight: '700',
      fontSize: 14,
    },
    fullBtn: {
      backgroundColor: c.primary,
      height: 44,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkBtn: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },
    linkText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 14,
    },
    fieldLabel: {
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
    disabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.88,
    },
    searchRow: {
      flexDirection: 'row',
      gap: 8,
    },
    search: {
      flex: 1,
      height: 44,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      fontSize: 15,
      color: c.text,
    },
    searchGo: {
      width: 52,
      height: 44,
      borderRadius: radii.sm,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchGoText: {
      color: c.primaryOn,
      fontWeight: '700',
    },
    searchHint: {
      fontSize: 13,
      color: c.muted,
    },
  });
}
