import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { displayGateName, getGate, type GateConfig } from '../../data/gatesStore';
import { ClipboardApi } from '../../platform/optionalExpo';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  createGateInvite,
  listOutgoingInvites,
  revokeInvite,
  type InviteDoc,
} from '../../share/invites';
import { BusySheet, ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { FormSheet } from '../components/FormSheet';
import { Group, Hairline } from '../components/Group';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ShareGate'>;

export function ShareGateScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const { gateId } = route.params;
  const [gate, setGate] = useState<GateConfig | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [outgoing, setOutgoing] = useState<Array<InviteDoc & { code: string }>>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const reload = useCallback(async () => {
    const g = await getGate(gateId);
    setGate(g);
    try {
      const all = await listOutgoingInvites();
      setOutgoing(
        all.filter(
          (inv) =>
            inv.gate.deviceId === g?.deviceId &&
            (inv.status === 'pending' || inv.status === 'accepted'),
        ),
      );
    } catch {
      setOutgoing([]);
    }
  }, [gateId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const ensureRealAccount = () => {
    if (user?.isRealAccount) return true;
    setUpgradeOpen(true);
    return false;
  };

  const makeCode = async (toEmail?: string) => {
    if (!gate) return;
    if (!ensureRealAccount()) return;
    setBusy(true);
    try {
      const created = await createGateInvite(gate, { toEmail });
      setCode(created.code);
      setEmailOpen(false);
      setEmail('');
      await reload();
    } catch (e) {
      setInfo({
        title: 'Share',
        message: e instanceof Error ? e.message : 'Could not create invite',
      });
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!code || !ClipboardApi) return;
    await ClipboardApi.setStringAsync(code);
    setInfo({ title: 'Copied', message: 'Invite code is on the clipboard.' });
  };

  if (!gate) {
    return <View style={styles.page} />;
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.title}>{displayGateName(gate)}</Text>
        <Text style={styles.body}>
          They type this code in GateAuto. The pin, radius, Bluetooth list, and
          PalGate open details copy to their phone. Only you and people who
          accept can read them.
        </Text>

        {code ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Invite code</Text>
            <Text selectable style={styles.code}>
              {code}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              onPress={() => void copyCode()}
            >
              <Text style={styles.primaryText}>Copy code</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            onPress={() => void makeCode()}
          >
            <Text style={styles.primaryText}>Create invite code</Text>
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={() => {
            if (!ensureRealAccount()) return;
            setEmailOpen(true);
          }}
        >
          <Text style={styles.secondaryText}>Send to an email</Text>
        </Pressable>

        {outgoing.length > 0 ? (
          <>
            <Text style={styles.section}>Invites for this gate</Text>
            <Group>
              {outgoing.map((inv, i) => (
                <View key={inv.code}>
                  {i > 0 ? <Hairline /> : null}
                  <View style={styles.row}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.rowTitle}>{inv.code}</Text>
                      <Text style={styles.rowMeta}>
                        {inv.status}
                        {inv.toEmailLower ? ` · ${inv.toEmailLower}` : ''}
                      </Text>
                    </View>
                    {inv.status !== 'revoked' ? (
                      <Pressable onPress={() => setRevokeTarget(inv.code)} hitSlop={8}>
                        <Text style={styles.revoke}>Revoke</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </Group>
          </>
        ) : null}
      </ScrollView>

      <FormSheet
        visible={emailOpen}
        title="Share by email"
        message="If they already use that email in GateAuto, the invite shows up on their systems screen. They can still type the code."
        fields={[
          {
            key: 'email',
            label: 'Email',
            value: email,
            onChange: setEmail,
            placeholder: 'friend@email.com',
            keyboardType: 'email-address',
          },
        ]}
        cancelLabel="Cancel"
        confirmLabel="Create invite"
        busy={busy}
        onCancel={() => setEmailOpen(false)}
        onConfirm={() => void makeCode(email)}
      />
      <ConfirmSheet
        visible={upgradeOpen}
        title="Sharing needs an account"
        message="Guest can open gates on this phone. To share a gate, sign in with Google or email so the other person can accept."
        cancelLabel="Not now"
        confirmLabel="Upgrade"
        onCancel={() => setUpgradeOpen(false)}
        onConfirm={() => {
          setUpgradeOpen(false);
          navigation.navigate('Settings');
        }}
      />
      <ConfirmSheet
        visible={revokeTarget != null}
        title="Revoke this invite?"
        message="They will lose the shared copy the next time their app syncs. You can send a new code later."
        cancelLabel="Keep"
        confirmLabel="Revoke"
        destructive
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          const id = revokeTarget;
          setRevokeTarget(null);
          if (id) void revokeInvite(id).then(() => reload());
        }}
      />
      <BusySheet visible={busy && !emailOpen} title="Invite" message="Creating a short code…" />
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
      gap: 12,
      paddingBottom: spacing.lg * 2,
      backgroundColor: c.background,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: c.text,
      letterSpacing: -0.4,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: c.muted,
    },
    codeCard: {
      backgroundColor: c.surface,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: 10,
      alignItems: 'center',
    },
    codeLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: c.primary,
    },
    code: {
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: 3,
      color: c.text,
      fontFamily: Platform.select({
        ios: 'Menlo',
        android: 'monospace',
        default: 'monospace',
      }),
    },
    primaryBtn: {
      height: 48,
      borderRadius: radii.pill,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
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
    section: {
      marginTop: 8,
      fontSize: 13,
      fontWeight: '700',
      color: c.muted,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 10,
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: c.text,
      letterSpacing: 1,
    },
    rowMeta: {
      fontSize: 13,
      color: c.muted,
    },
    revoke: {
      color: c.danger,
      fontWeight: '700',
      fontSize: 14,
    },
    pressed: {
      opacity: 0.88,
    },
  });
}
