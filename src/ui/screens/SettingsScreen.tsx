import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appendEvent } from '../../data/eventLog';
import { clearCredentials } from '../../data/credentials';
import { tryStopGeofencing } from '../../integrations/optionalNative';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { AppearancePicker } from '../components/AppearancePicker';
import { AutoOpenSettings } from '../components/AutoOpenSettings';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { Group, Hairline } from '../components/Group';
import {
  IconChevronRight,
  IconExport,
  IconShield,
  IconUnlink,
} from '../icons';
import { useTheme } from '../ThemeProvider';
import { spacing, type ThemeColors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const runUnlink = () => {
    setUnlinkOpen(false);
    void (async () => {
      await tryStopGeofencing();
      await clearCredentials();
      await appendEvent({ kind: 'info', message: 'Account unlinked' });
      navigation.reset({
        index: 0,
        routes: [{ name: 'LinkAccount' }],
      });
    })();
  };

  return (
    <>
    <ScrollView contentContainerStyle={styles.page}>
      <AutoOpenSettings />
      <AppearancePicker />

      <Group>
        <SettingsRow
          icon={<IconShield color={colors.primary} />}
          label="Permissions"
          detail="Location, Bluetooth, battery"
          onPress={() => navigation.navigate('Permissions')}
          colors={colors}
        />
        <Hairline inset={56} />
        <SettingsRow
          icon={<IconExport color={colors.primary} />}
          label="Export"
          detail="QR for another phone"
          onPress={() => navigation.navigate('ExportAccount')}
          colors={colors}
        />
      </Group>

      <Group>
        <SettingsRow
          icon={<IconUnlink color={colors.danger} />}
          label="Unlink account"
          detail="Remove PalGate from this phone"
          onPress={() => setUnlinkOpen(true)}
          colors={colors}
          destructive
        />
      </Group>
    </ScrollView>
    <ConfirmSheet
      visible={unlinkOpen}
      icon={<IconUnlink color={colors.danger} />}
      title="Unlink this phone?"
      message="PalGate credentials leave this device and auto-open stops until you link again."
      cancelLabel="Keep linked"
      confirmLabel="Unlink"
      destructive
      onCancel={() => setUnlinkOpen(false)}
      onConfirm={runUnlink}
    />
    </>
  );
}

function SettingsRow({
  icon,
  label,
  detail,
  onPress,
  colors,
  destructive,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  onPress: () => void;
  colors: ThemeColors;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.surfacePressed }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingVertical: 16,
          paddingHorizontal: 16,
          backgroundColor: pressed ? colors.surfacePressed : colors.surface,
        },
      ]}
    >
      <View style={{ width: 28, alignItems: 'center' }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            fontSize: 17,
            fontWeight: '600',
            color: destructive ? colors.danger : colors.text,
            letterSpacing: -0.2,
          }}
        >
          {label}
        </Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>{detail}</Text>
      </View>
      <IconChevronRight color={destructive ? colors.danger : colors.muted} />
    </Pressable>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    page: {
      padding: spacing.md,
      gap: spacing.md,
      paddingBottom: spacing.lg,
      backgroundColor: c.background,
    },
  });
}
