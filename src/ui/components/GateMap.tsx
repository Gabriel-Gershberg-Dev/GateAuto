import Constants from 'expo-constants';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { gateMapStyle } from '../mapStyle';
import { hasNativeStreetView } from '../streetViewNative';
import { type ThemeColors } from '../theme';

const VIEW_DELTA = 0.005;

type Props = {
  lat: number;
  lng: number;
  radiusMeters: number;
  onChange?: (lat: number, lng: number) => void;
  /** Pan, zoom, tap/long-press to pin, and drag. Editor map is always interactive. */
  interactive?: boolean;
  showsUserLocation?: boolean;
  /** Hide the gate mark until a pin exists (camera still shows). */
  showPin?: boolean;
  onGestureLock?: (locked: boolean) => void;
};

type ExtraConfig = {
  hasGoogleMaps?: unknown;
};

type CameraTarget = {
  animateToRegion: (
    region: {
      latitude: number;
      longitude: number;
      latitudeDelta: number;
      longitudeDelta: number;
    },
    duration?: number,
  ) => void;
};

function mapsKeyFromExpoConfig(): string {
  const expo = Constants.expoConfig;
  const androidKey = expo?.android?.config?.googleMaps?.apiKey;
  const iosKey = expo?.ios?.config?.googleMapsApiKey;
  const key = androidKey || iosKey;
  return typeof key === 'string' ? key.trim() : '';
}

/**
 * True when this build can show Google Maps. Uses a boolean extra so the
 * editor is not gated on reading the secret key from Constants (Street View
 * already works off the native manifest key).
 */
export function hasGoogleMapsApiKey(): boolean {
  const extra = Constants.expoConfig?.extra as ExtraConfig | undefined;
  if (extra?.hasGoogleMaps === true) return true;
  if (mapsKeyFromExpoConfig().length > 0) return true;
  return Platform.OS === 'android' && hasNativeStreetView();
}

/**
 * Optional map. react-native-maps is required only when a key exists and this
 * component renders — never on Link / Permissions / GatesList startup.
 */
export function GateMap({
  lat,
  lng,
  radiusMeters,
  onChange,
  interactive = true,
  showsUserLocation = false,
  showPin = true,
  onGestureLock,
}: Props) {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const mapStyle = useMemo(
    () => gateMapStyle(scheme, colors),
    [scheme, colors],
  );
  const mapRef = useRef<CameraTarget | null>(null);
  const skipCamera = useRef(true);
  const fromMap = useRef(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trackMark, setTrackMark] = useState(true);

  const lockGestures = () => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    onGestureLock?.(true);
  };

  const unlockGestures = () => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => onGestureLock?.(false), 240);
  };

  useEffect(() => {
    return () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    };
  }, []);

  useEffect(() => {
    setTrackMark(true);
    const t = setTimeout(() => setTrackMark(false), 450);
    return () => clearTimeout(t);
  }, [lat, lng, colors.primary, showPin]);

  useEffect(() => {
    if (skipCamera.current) {
      skipCamera.current = false;
      return;
    }
    if (fromMap.current) {
      fromMap.current = false;
      return;
    }
    mapRef.current?.animateToRegion(
      {
        latitude: lat,
        longitude: lng,
        latitudeDelta: VIEW_DELTA,
        longitudeDelta: VIEW_DELTA,
      },
      280,
    );
  }, [lat, lng]);

  if (!hasGoogleMapsApiKey()) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.meta}>
          Map preview unavailable (no Google Maps API key).
        </Text>
        <Text style={styles.preview}>
          {lat.toFixed(6)}, {lng.toFixed(6)} · radius {radiusMeters} m
        </Text>
      </View>
    );
  }

  // Lazy require: avoid initializing the maps native module without a key.
  const maps = require('react-native-maps') as typeof import('react-native-maps');
  const MapView = maps.default;
  const { Marker, Circle, PROVIDER_GOOGLE } = maps;

  const move = (nextLat: number, nextLng: number) => {
    fromMap.current = true;
    onChange?.(nextLat, nextLng);
  };

  const dropAt = (nextLat: number, nextLng: number) => {
    lockGestures();
    move(nextLat, nextLng);
    unlockGestures();
  };

  return (
    <View
      style={styles.map}
      collapsable={false}
      onTouchStart={lockGestures}
      onTouchEnd={unlockGestures}
      onTouchCancel={unlockGestures}
    >
      <MapView
        ref={(node) => {
          mapRef.current = node;
        }}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={mapStyle}
        toolbarEnabled={false}
        liteMode={false}
        pitchEnabled={false}
        rotateEnabled={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        zoomControlEnabled={false}
        moveOnMarkerPress={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        showsBuildings={false}
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
        mapPadding={{ top: 8, right: 8, bottom: 28, left: 8 }}
        initialRegion={{
          latitude: lat,
          longitude: lng,
          latitudeDelta: VIEW_DELTA,
          longitudeDelta: VIEW_DELTA,
        }}
        onPress={
          interactive
            ? (e) => {
                dropAt(
                  e.nativeEvent.coordinate.latitude,
                  e.nativeEvent.coordinate.longitude,
                );
              }
            : undefined
        }
        onPoiClick={
          interactive
            ? (e) => {
                dropAt(
                  e.nativeEvent.coordinate.latitude,
                  e.nativeEvent.coordinate.longitude,
                );
              }
            : undefined
        }
        onLongPress={
          interactive
            ? (e) => {
                dropAt(
                  e.nativeEvent.coordinate.latitude,
                  e.nativeEvent.coordinate.longitude,
                );
              }
            : undefined
        }
        onPanDrag={interactive ? lockGestures : undefined}
        onRegionChangeComplete={unlockGestures}
      >
        {showPin ? (
          <>
            <Marker
              coordinate={{ latitude: lat, longitude: lng }}
              draggable={interactive}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={trackMark}
              onDragStart={lockGestures}
              onDragEnd={(e) => {
                dropAt(
                  e.nativeEvent.coordinate.latitude,
                  e.nativeEvent.coordinate.longitude,
                );
              }}
            >
              <View style={styles.mark} pointerEvents="none">
                <View style={styles.markRing} />
                <View style={styles.markCore} />
              </View>
            </Marker>
            <Circle
              center={{ latitude: lat, longitude: lng }}
              radius={radiusMeters}
              strokeColor={colors.primary}
              strokeWidth={2}
              fillColor={colors.mapFill}
            />
          </>
        ) : null}
      </MapView>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    map: {
      flex: 1,
    },
    placeholder: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
      paddingHorizontal: 16,
      gap: 8,
    },
    meta: {
      fontSize: 13,
      color: c.muted,
      textAlign: 'center',
    },
    preview: {
      fontSize: 14,
      color: c.text,
      fontWeight: '600',
      textAlign: 'center',
    },
    mark: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markRing: {
      ...StyleSheet.absoluteFill,
      borderRadius: 11,
      borderWidth: 2.5,
      borderColor: c.primary,
      backgroundColor: 'transparent',
    },
    markCore: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.primary,
    },
  });
}
