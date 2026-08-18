import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { hasAnySystem, listSystems, type PalGateSystem } from '../../data/palgateSystems';
import { goToGatesList } from '../../navigation/hubNavigation';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  acceptInvite,
  declineInvite,
  listIncomingPendingInvites,
  syncRevokedShares,
  type InviteDoc,
} from '../../share/invites';
import { isValidInviteCode, normalizeInviteCode } from '../../share/inviteLogic';
import { BarrierMark } from '../components/BarrierMark';
import { BusySheet, ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { FormSheet } from '../components/FormSheet';
import { Group, Hairline } from '../components/Group';
import { IconChevronRight, IconQr, IconShare } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'GateSystems'>;

export function GateSystemsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const [systems, setSystems] = useState<PalGateSystem[]>([]);
  const [incoming, setIncoming] = useState<Array<InviteDoc & { code: string }>>(
    [],
  );
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );
  const [confirmIncoming, setConfirmIncoming] = useState<
    (InviteDoc & { code: string }) | null
  >(null);

  const reload = useCallback(async () => {
    setSystems(await listSystems());
    try {
      await syncRevokedShares();
      setIncoming(await listIncomingPendingInvites());
    } catch {
      setIncoming([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const empty = systems.length === 0;
  const goScan = (purpose: 'primary' | 'additional') => {
    navigation.navigate('LinkAccount', { purpose });
  };

  const submitCode = async () => {
    setCodeError(null);
    const normalized = normalizeInviteCode(code);
    if (!isValidInviteCode(normalized)) {
      setCodeError('Enter the 8-character code from the owner.');
      return;
    }
    setBusy(true);
    try {
      await acceptInvite(normalized);
      setCodeOpen(false);
      setCode('');
      const linked = await hasAnySystem();
      navigation.reset({
        index: linked ? 1 : 0,
        routes: linked
          ? [{ name: 'GateSystems' }, { name: 'GatesList' }]
          : [{ name: 'GateSystems' }],
      });
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : 'Could not accept invite');
    } finally {
      setBusy(false);
    }
  };

  const acceptIncoming = async () => {
    const inv = confirmIncoming;
    if (!inv) return;
    setConfirmIncoming(null);
    setBusy(true);
    try {
      await acceptInvite(inv.code);
      navigation.reset({
        index: 1,
        routes: [{ name: 'GateSystems' }, { name: 'GatesList' }],
      });
    } catch (e) {
      setInfo({
        title: 'Invite',
        message: e instanceof Error ? e.message : 'Could not accept',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        {empty ? (
          <View style={styles.emptyHero}>
            <BarrierMark brand size={56} />
            <Text style={styles.kicker}>Your gate systems</Text>
            <Text style={styles.title}>Scan your PalGate first</Text>
            <Text style={styles.body}>
              Open PalGate on this phone, add a Linked Device, and scan the QR
              GateAuto shows next. That is your neighborhood. The same button
              later links another PalGate — a second street, a second home.
            </Text>
          </View>
        ) : (
          <Text style={styles.sectionTitle}>Linked PalGate</Text>
        )}

        {systems.map((sys) => (
          <View key={sys.id} style={styles.systemCard}>
            <Text style={styles.systemLabel}>{sys.label}</Text>
            <Text style={styles.systemMeta}>
              {sys.origin === 'shared' ? 'From an invite' : 'Scanned on this phone'}
              {' · '}
              {String(sys.credentials.phoneNumber).slice(-4)}
            </Text>
          </View>
        ))}

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={() => goScan(empty ? 'primary' : 'additional')}
        >
          <IconQr color={colors.primaryOn} />
          <Text style={styles.primaryText}>
            {empty ? 'Scan your PalGate QR' : 'Link another PalGate'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={() => {
            setCodeError(null);
            setCodeOpen(true);
          }}
        >
          <Text style={styles.secondaryText}>Enter invite code</Text>
        </Pressable>

        {incoming.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Waiting for you</Text>
            <Group>
              {incoming.map((inv, i) => (
                <View key={inv.code}>
                  {i > 0 ? <Hairline /> : null}
                  <Pressable
                    onPress={() => setConfirmIncoming(inv)}
                    style={({ pressed }) => [
                      styles.inviteRow,
                      pressed && { backgroundColor: colors.surfacePressed },
                    ]}
                  >
                    <IconShare color={colors.primary} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.inviteTitle} numberOfLines={2}>
                        {inv.gates.length > 1
                          ? `${inv.gates.length} gates`
                          : inv.gate.nameOverride || inv.gate.name || 'Shared gate'}
                      </Text>
                      <Text style={styles.inviteMeta}>
                        From {inv.fromName || 'someone'} · {inv.code}
                      </Text>
                    </View>
                    <IconChevronRight color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </Group>
          </>
        ) : null}

        {!empty ? (
          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
            onPress={() => goToGatesList(navigation)}
          >
            <Text style={styles.ghostText}>Go to gates</Text>
          </Pressable>
        ) : null}

        <Text style={styles.footnote}>
          {user?.isRealAccount
            ? 'Signed in — you can share gates and accept invites.'
            : 'Guest on this phone. Upgrade in Settings when you want to share a gate.'}
        </Text>
      </ScrollView>

      <FormSheet
        visible={codeOpen}
        title="Invite code"
        message="Type the 8-character code the owner showed you. The gate pin and open credentials copy to this phone."
        fields={[
          {
            key: 'code',
            label: 'Code',
            value: code,
            onChange: setCode,
            placeholder: 'e.g. 7K3MNP2Q',
            autoCapitalize: 'none',
          },
        ]}
        cancelLabel="Cancel"
        confirmLabel="Accept"
        error={codeError}
        busy={busy}
        onCancel={() => setCodeOpen(false)}
        onConfirm={() => void submitCode()}
      />
      <ConfirmSheet
        visible={confirmIncoming != null}
        title="Accept this gate?"
        message={
          confirmIncoming
            ? confirmIncoming.gates.length > 1
              ? `${confirmIncoming.gates.length} gates from ${confirmIncoming.fromName || 'someone'}. Pins and PalGate details copy here. Auto-open stays off until you turn it on.`
              : `${confirmIncoming.gate.nameOverride || confirmIncoming.gate.name} from ${confirmIncoming.fromName || 'someone'}. Pin and PalGate details copy here. Auto-open stays off until you turn it on.`
            : ''
        }
        cancelLabel="Decline"
        confirmLabel="Accept"
        onCancel={() => {
          const inv = confirmIncoming;
          setConfirmIncoming(null);
          if (inv) void declineInvite(inv.code).then(() => reload());
        }}
        onConfirm={() => void acceptIncoming()}
      />
      <BusySheet
        visible={busy && !codeOpen}
        title="Invite"
        message="Copying gate details to this phone…"
      />
      <InfoSheet
        visible={info != null}
        title={info?.title ?? ''}
        message={info?.message ?? ''}
        onDismiss={() => setInfo(null)}
      />
    </>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    page: {
      padding: spacing.md,
      gap: 10,
      paddingBottom: spacing.lg * 2,
      backgroundColor: c.background,
    },
    emptyHero: {
      alignItems: 'center',
      gap: 10,
      paddingVertical: spacing.md,
      paddingHorizontal: 6,
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
      textAlign: 'center',
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: c.muted,
      textAlign: 'center',
    },
    sectionTitle: {
      marginTop: 6,
      fontSize: 13,
      fontWeight: '700',
      color: c.muted,
      letterSpacing: 0.4,
    },
    systemCard: {
      backgroundColor: c.surface,
      borderRadius: radii.md,
      paddingVertical: 14,
      paddingHorizontal: 16,
      gap: 2,
      borderWidth: 1,
      borderColor: c.border,
    },
    systemLabel: {
      fontSize: 17,
      fontWeight: '600',
      color: c.text,
    },
    systemMeta: {
      fontSize: 13,
      color: c.muted,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      height: 48,
      borderRadius: radii.pill,
      backgroundColor: c.primary,
    },
    primaryText: {
      color: c.primaryOn,
      fontWeight: '700',
      fontSize: 15,
    },
    secondaryBtn: {
      height: 48,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
    },
    secondaryText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 15,
    },
    ghostBtn: {
      alignItems: 'center',
      paddingVertical: 10,
    },
    ghostText: {
      color: c.text,
      fontWeight: '700',
      fontSize: 15,
    },
    inviteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    inviteTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    inviteMeta: {
      fontSize: 13,
      color: c.muted,
    },
    footnote: {
      fontSize: 12,
      lineHeight: 18,
      color: c.muted,
      textAlign: 'center',
      marginTop: 8,
    },
    pressed: {
      opacity: 0.88,
    },
  });
}
