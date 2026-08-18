import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  requireNativeComponent,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ThemeProvider';
import {
  hasNativeStreetView,
  openExternalStreetView,
  STREET_VIEW_NATIVE,
} from '../streetViewNative';
import { formatCoordPair } from '../streetName';
import {
  resolveStreetViewPin,
  STREET_VIEW_FALLBACK_HINT,
  type StreetViewPin,
} from '../streetViewPin';
import { radii, spacing, type ThemeColors } from '../theme';

type CoverageEvent = {
  available: boolean;
  latitude?: number;
  longitude?: number;
};

type NativeProps = ViewProps & {
  latitude: number;
  longitude: number;
  onCoverageChange?: (e: NativeSyntheticEvent<CoverageEvent>) => void;
};

let NativeStreetView: ReturnType<typeof requireNativeComponent<NativeProps>> | null =
  null;

function getNativeStreetView() {
  if (!hasNativeStreetView()) return null;
  if (!NativeStreetView) {
    NativeStreetView = requireNativeComponent<NativeProps>(STREET_VIEW_NATIVE);
  }
  return NativeStreetView;
}

type Props = {
  visible: boolean;
  lat: number;
  lng: number;
  streetName?: string | null;
  confirmLabel?: string;
  onConfirm: (pin: StreetViewPin) => void;
  onBack: () => void;
};

export function StreetViewSheet({
  visible,
  lat,
  lng,
  streetName,
  confirmLabel = 'Pin this place',
  onConfirm,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const NativeView = visible ? getNativeStreetView() : null;
  const [coverage, setCoverage] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [openingMaps, setOpeningMaps] = useState(false);
  const [panoLat, setPanoLat] = useState<number | null>(null);
  const [panoLng, setPanoLng] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) {
      setCoverage('unknown');
      setOpeningMaps(false);
      setPanoLat(null);
      setPanoLng(null);
    }
  }, [visible, lat, lng]);

  const pin = resolveStreetViewPin(panoLat, panoLng, lat, lng);
  const showFallbackHint =
    NativeView != null && coverage !== 'unknown' && pin.source === 'fallback';

  const openMaps = async () => {
    if (openingMaps) return;
    setOpeningMaps(true);
    try {
      await openExternalStreetView(lat, lng);
    } finally {
      setOpeningMaps(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onBack}
    >
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topBar}>
          <Text style={styles.kicker}>Street sightline</Text>
          <Text style={styles.title} numberOfLines={2}>
            {streetName?.trim() || 'Look at this pin'}
          </Text>
          <Text style={styles.coords}>
            {formatCoordPair(pin.lat, pin.lng)}
          </Text>
          {showFallbackHint ? (
            <Text style={styles.hint}>{STREET_VIEW_FALLBACK_HINT}</Text>
          ) : null}
        </View>

        <View style={styles.panoWrap}>
          {NativeView ? (
            <>
              <NativeView
                style={StyleSheet.absoluteFill}
                latitude={lat}
                longitude={lng}
                onCoverageChange={(e) => {
                  setCoverage(e.nativeEvent.available ? 'yes' : 'no');
                  const nextLat = e.nativeEvent.latitude;
                  const nextLng = e.nativeEvent.longitude;
                  if (
                    typeof nextLat === 'number' &&
                    typeof nextLng === 'number'
                  ) {
                    setPanoLat(nextLat);
                    setPanoLng(nextLng);
                  }
                }}
              />
              {coverage === 'unknown' ? (
                <View style={styles.loading} pointerEvents="none">
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.fallback}>
              <Text style={styles.fallbackTitle}>Open Street View in Maps</Text>
              <Text style={styles.fallbackBody}>
                In-app panorama isn’t in this build. Check the street in Google
                Maps, then come back and use the pin.
              </Text>
              <Pressable
                onPress={() => void openMaps()}
                style={({ pressed }) => [
                  styles.mapsBtn,
                  pressed && styles.pressed,
                ]}
                disabled={openingMaps}
              >
                <Text style={styles.mapsBtnText}>
                  {openingMaps ? 'Opening…' : 'Open Street View'}
                </Text>
              </Pressable>
            </View>
          )}

          {NativeView && coverage === 'no' ? (
            <View style={styles.noCoverage}>
              <Text style={styles.noCoverageText}>
                No street imagery here — you can still use the pin.
              </Text>
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.actions,
            { paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
        >
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [
              styles.btn,
              styles.btnGhost,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.btnGhostText}>Back to the map</Text>
          </Pressable>
          <Pressable
            onPress={() => onConfirm(pin)}
            style={({ pressed }) => [
              styles.btn,
              styles.btnPrimary,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    topBar: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      gap: 4,
    },
    kicker: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: c.primary,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: c.text,
      letterSpacing: -0.4,
    },
    coords: {
      fontSize: 12,
      fontFamily: 'monospace',
      color: c.muted,
    },
    hint: {
      fontSize: 13,
      lineHeight: 18,
      color: c.muted,
      marginTop: 4,
    },
    panoWrap: {
      flex: 1,
      marginHorizontal: spacing.md,
      borderRadius: radii.md,
      overflow: 'hidden',
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    loading: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(3, 6, 7, 0.4)',
    },
    fallback: {
      flex: 1,
      padding: spacing.lg,
      justifyContent: 'center',
      gap: 10,
    },
    fallbackTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: c.text,
    },
    fallbackBody: {
      fontSize: 15,
      lineHeight: 22,
      color: c.muted,
    },
    mapsBtn: {
      alignSelf: 'flex-start',
      marginTop: 6,
      backgroundColor: c.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderRadius: radii.pill,
    },
    mapsBtnText: {
      color: c.primaryOn,
      fontWeight: '700',
    },
    noCoverage: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 10,
      backgroundColor: c.surface,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: c.border,
    },
    noCoverageText: {
      fontSize: 13,
      lineHeight: 18,
      color: c.text,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    btn: {
      flex: 1,
      height: 48,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnGhost: {
      backgroundColor: c.surface,
    },
    btnGhostText: {
      color: c.text,
      fontWeight: '700',
      fontSize: 15,
    },
    btnPrimary: {
      backgroundColor: c.primary,
    },
    btnPrimaryText: {
      color: c.primaryOn,
      fontWeight: '700',
      fontSize: 15,
    },
    pressed: {
      opacity: 0.88,
    },
  });
}
