import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { isolateBidiText } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import {
  autocompleteAddresses,
  lookupAddresses,
  newPlacesSession,
  placeLocation,
} from '../addressLookup';
import {
  addressSuggestions,
  placeSuggestions,
  type AddressSuggestion,
} from '../addressSearch';
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
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { isRtl, row, writingDirection, textAlign, inputAlign } = useRtlLayout();
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
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const searchGen = useRef(0);
  /** After a pick, don't reopen the list for the label we just wrote. */
  const pickedQuery = useRef<string | null>(null);
  const placesSession = useRef(newPlacesSession());
  /** Rank suggestions around what the map shows, without re-running on pan. */
  const searchNear = useRef({ lat: lat ?? DEFAULT_LAT, lng: lng ?? DEFAULT_LNG });
  searchNear.current = { lat: lat ?? viewLat, lng: lng ?? viewLng };
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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === pickedQuery.current) {
      setSuggestions([]);
      if (q.length < 2) setSearchHint(null);
      return;
    }
    const gen = ++searchGen.current;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchHint(null);
      void (async () => {
        const places = await autocompleteAddresses(q, {
          session: placesSession.current,
          lang: i18n.language,
          near: searchNear.current,
        });
        const fromPlaces = places ? placeSuggestions(places) : [];
        if (fromPlaces.length > 0) return fromPlaces;
        return addressSuggestions(await lookupAddresses(q));
      })()
        .then((next) => {
          if (gen !== searchGen.current) return;
          setSuggestions(next);
          setSearchHint(next.length === 0 ? t('map.noMatch') : null);
        })
        .catch(() => {
          if (gen !== searchGen.current) return;
          setSuggestions([]);
          setSearchHint(t('map.lookupFail'));
        })
        .finally(() => {
          if (gen === searchGen.current) setSearching(false);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, t, i18n.language]);

  const dropPin = (latitude: number, longitude: number) => {
    setViewLat(latitude);
    setViewLng(longitude);
    onProposePin(latitude, longitude);
  };

  const pickSuggestion = (item: AddressSuggestion) => {
    pickedQuery.current = item.title;
    searchGen.current++;
    setQuery(item.title);
    setSuggestions([]);
    setSearchHint(null);
    if (item.latitude != null && item.longitude != null) {
      dropPin(item.latitude, item.longitude);
      return;
    }
    if (!item.placeId) return;
    const session = placesSession.current;
    placesSession.current = newPlacesSession();
    setSearching(true);
    void (async () => {
      const place = await placeLocation(item.placeId as string, {
        session,
        lang: i18n.language,
      });
      if (place) return place;
      const hits = await lookupAddresses(
        [item.title, item.subtitle].filter(Boolean).join(', '),
      );
      return hits[0] ?? null;
    })()
      .then((place) => {
        if (place) dropPin(place.latitude, place.longitude);
        else setSearchHint(t('map.lookupFail'));
      })
      .catch(() => setSearchHint(t('map.lookupFail')))
      .finally(() => setSearching(false));
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
          <View style={styles.searchField}>
            <TextInput
              style={[
                styles.search,
                searching && styles.searchBusy,
                { writingDirection, textAlign: inputAlign },
              ]}
              value={query}
              onChangeText={(text) => {
                pickedQuery.current = null;
                setQuery(text);
              }}
              placeholder={t('map.findStreet')}
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              autoCorrect={false}
            />
            {searching ? (
              <ActivityIndicator
                color={colors.primary}
                size="small"
                style={styles.searchSpin}
              />
            ) : null}
          </View>
          {suggestions.length > 1 ? (
            <Text style={[styles.searchHint, { writingDirection, textAlign }]}>
              {t('map.pickOne')}
            </Text>
          ) : null}
          {suggestions.length > 0 ? (
            <ScrollView
              style={styles.suggestList}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {suggestions.map((item, index) => (
                <Pressable
                  key={item.key}
                  onPress={() => pickSuggestion(item)}
                  android_ripple={{ color: colors.surfacePressed }}
                  style={({ pressed }) => [
                    styles.suggestRow,
                    { flexDirection: row },
                    index > 0 && styles.suggestDivider,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.suggestTick} />
                  <View style={styles.suggestCopy}>
                    <Text
                      style={[styles.suggestTitle, { writingDirection, textAlign }]}
                      numberOfLines={2}
                    >
                      {isolateBidiText(item.title, isRtl)}
                    </Text>
                    {item.subtitle ? (
                      <Text
                        style={[
                          styles.suggestSubtitle,
                          { writingDirection, textAlign },
                        ]}
                        numberOfLines={1}
                      >
                        {isolateBidiText(item.subtitle, isRtl)}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {searchHint ? (
            <Text style={[styles.searchHint, { writingDirection, textAlign }]}>
              {searchHint}
            </Text>
          ) : null}

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
    searchField: {
      justifyContent: 'center',
    },
    search: {
      height: 44,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      fontSize: 15,
      color: c.text,
    },
    searchBusy: {
      paddingEnd: 40,
    },
    searchSpin: {
      position: 'absolute',
      end: 14,
    },
    searchHint: {
      fontSize: 13,
      color: c.muted,
    },
    suggestList: {
      maxHeight: 240,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    suggestRow: {
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    suggestDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
    suggestTick: {
      width: 3,
      alignSelf: 'stretch',
      borderRadius: 2,
      backgroundColor: c.primary,
    },
    suggestCopy: {
      flex: 1,
      gap: 2,
    },
    suggestTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: c.text,
    },
    suggestSubtitle: {
      fontSize: 13,
      color: c.muted,
    },
  });
}
