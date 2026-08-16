import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ThemeProvider';
import { formatCoordPair } from '../streetName';
import { radii, spacing, type ThemeColors } from '../theme';
import { GateMap } from './GateMap';

type Props = {
  visible: boolean;
  lat: number;
  lng: number;
  radiusMeters: number;
  showPin: boolean;
  streetName?: string | null;
  onConfirm: (lat: number, lng: number) => void;
  onBack: () => void;
};

export function PinMapSheet({
  visible,
  lat,
  lng,
  radiusMeters,
  showPin,
  streetName,
  onConfirm,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [draftLat, setDraftLat] = useState(lat);
  const [draftLng, setDraftLng] = useState(lng);
  const [draftPinned, setDraftPinned] = useState(showPin);

  useEffect(() => {
    if (!visible) return;
    setDraftLat(lat);
    setDraftLng(lng);
    setDraftPinned(showPin);
  }, [visible, lat, lng, showPin]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onBack}
    >
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topBar}>
          <Text style={styles.kicker}>Gate pin</Text>
          <Text style={styles.title} numberOfLines={2}>
            {streetName?.trim() ||
              (draftPinned ? 'Dropped pin' : 'Tap the road to pin')}
          </Text>
          <Text style={styles.coords}>
            {draftPinned
              ? formatCoordPair(draftLat, draftLng)
              : 'Tap, hold, or drag the mark'}
          </Text>
        </View>

        <View style={styles.mapWrap}>
          <GateMap
            lat={draftLat}
            lng={draftLng}
            radiusMeters={radiusMeters}
            interactive
            showPin={draftPinned}
            showsUserLocation
            onChange={(nextLat, nextLng) => {
              setDraftLat(nextLat);
              setDraftLng(nextLng);
              setDraftPinned(true);
            }}
          />
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
            <Text style={styles.btnGhostText}>Back to the editor</Text>
          </Pressable>
          <Pressable
            onPress={() => onConfirm(draftLat, draftLng)}
            disabled={!draftPinned}
            style={({ pressed }) => [
              styles.btn,
              styles.btnPrimary,
              (!draftPinned || pressed) && draftPinned && styles.pressed,
              !draftPinned && styles.disabled,
            ]}
          >
            <Text style={styles.btnPrimaryText}>Use this pin</Text>
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
    mapWrap: {
      flex: 1,
      marginHorizontal: spacing.md,
      borderRadius: radii.md,
      overflow: 'hidden',
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
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
    disabled: {
      opacity: 0.5,
    },
  });
}
