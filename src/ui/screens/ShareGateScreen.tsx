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
import { displayGateName, loadGates, type GateConfig } from '../../data/gatesStore';
import { isolateBidiText } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { ClipboardApi } from '../../platform/optionalExpo';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  createGateInvites,
  listOutgoingInvites,
  revokeInvite,
  type InviteDoc,
} from '../../share/invites';
import { BusySheet, ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { FormSheet } from '../components/FormSheet';
import { Group, Hairline } from '../components/Group';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'ShareGate'>;

export function ShareGateScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { isRtl, row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const ids = useMemo(() => {
    const fromList = route.params?.gateIds?.filter(Boolean) ?? [];
    if (fromList.length) return fromList;
    return route.params?.gateId ? [route.params.gateId] : [];
  }, [route.params?.gateId, route.params?.gateIds]);
  const [gates, setGates] = useState<GateConfig[]>([]);
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
    const allGates = await loadGates();
    const selected = ids
      .map((id) => allGates.find((g) => g.id === id))
      .filter((g): g is GateConfig => Boolean(g));
    setGates(selected);
    const deviceIds = new Set(selected.map((g) => g.deviceId));
    try {
      const all = await listOutgoingInvites();
      setOutgoing(
        all.filter(
          (inv) =>
            (inv.status === 'pending' || inv.status === 'accepted') &&
            inv.gates.some((g) => deviceIds.has(g.deviceId)),
        ),
      );
    } catch {
      setOutgoing([]);
    }
  }, [ids]);

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
    if (gates.length === 0) return;
    if (!ensureRealAccount()) return;
    setBusy(true);
    try {
      const created = await createGateInvites(gates, { toEmail });
      setCode(created.code);
      setEmailOpen(false);
      setEmail('');
      await reload();
    } catch (e) {
      setInfo({
        title: t('share.title'),
        message: e instanceof Error ? e.message : t('share.createFail'),
      });
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!code || !ClipboardApi) return;
    await ClipboardApi.setStringAsync(code);
    setInfo({ title: t('common.copied'), message: t('share.copiedMsg') });
  };

  if (gates.length === 0) {
    return <View style={styles.page} />;
  }

  const many = gates.length > 1;
  const title = many
    ? t('share.manyTitle', { count: gates.length })
    : displayGateName(gates[0]);

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={[styles.title, { writingDirection, textAlign }]}>
          {many ? title : isolateBidiText(title, isRtl)}
        </Text>
        <Text style={styles.body}>
          {many
            ? t('share.bodyMany')
            : t('share.bodyOne')}
        </Text>
        {many
          ? gates.map((g) => (
              <Text
                key={g.id}
                style={[styles.gateName, { writingDirection, textAlign }]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {isolateBidiText(displayGateName(g), isRtl)}
              </Text>
            ))
          : null}

        {code ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>{t('share.inviteCode')}</Text>
            <Text selectable style={styles.code}>
              {code}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              onPress={() => void copyCode()}
            >
              <Text style={styles.primaryText}>{t('share.copyCode')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            onPress={() => void makeCode()}
          >
            <Text style={styles.primaryText}>{t('share.createCode')}</Text>
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={() => {
            if (!ensureRealAccount()) return;
            setEmailOpen(true);
          }}
        >
          <Text style={styles.secondaryText}>{t('share.sendEmail')}</Text>
        </Pressable>

        {outgoing.length > 0 ? (
          <>
            <Text style={styles.section}>{t('share.invitesFor')}</Text>
            <Group>
              {outgoing.map((inv, i) => (
                <View key={inv.code}>
                  {i > 0 ? <Hairline /> : null}
                  <View style={[styles.row, { flexDirection: row }]}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text
                        style={[styles.rowTitle, { writingDirection, textAlign }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {inv.code}
                      </Text>
                      <Text
                        style={[styles.rowMeta, { writingDirection, textAlign }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {t(`share.status_${inv.status}`)}
                        {inv.toEmailLower ? ` · ${inv.toEmailLower}` : ''}
                      </Text>
                    </View>
                    {inv.status !== 'revoked' ? (
                      <Pressable onPress={() => setRevokeTarget(inv.code)} hitSlop={8}>
                        <Text style={styles.revoke}>{t('common.revoke')}</Text>
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
        title={t('share.emailTitle')}
        message={t('share.emailMsg')}
        fields={[
          {
            key: 'email',
            label: t('common.email'),
            value: email,
            onChange: setEmail,
            placeholder: t('share.friendEmail'),
            keyboardType: 'email-address',
          },
        ]}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('share.createInvite')}
        busy={busy}
        onCancel={() => setEmailOpen(false)}
        onConfirm={() => void makeCode(email)}
      />
      <ConfirmSheet
        visible={upgradeOpen}
        title={t('gates.shareNeedsAccount')}
        message={t('share.needsAccountMsg')}
        cancelLabel={t('common.notNow')}
        confirmLabel={t('common.upgrade')}
        onCancel={() => setUpgradeOpen(false)}
        onConfirm={() => {
          setUpgradeOpen(false);
          navigation.navigate('Settings');
        }}
      />
      <ConfirmSheet
        visible={revokeTarget != null}
        title={t('share.revokeTitle')}
        message={t('share.revokeMsg')}
        cancelLabel={t('common.keep')}
        confirmLabel={t('common.revoke')}
        destructive
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          const id = revokeTarget;
          setRevokeTarget(null);
          if (id) void revokeInvite(id).then(() => reload());
        }}
      />
      <BusySheet visible={busy && !emailOpen} title={t('systems.invite')} message={t('share.creating')} />
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
    gateName: {
      fontSize: 15,
      fontWeight: '600',
      color: c.text,
    },
    codeCard: {
      backgroundColor: c.surface,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: 10,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.border,
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
