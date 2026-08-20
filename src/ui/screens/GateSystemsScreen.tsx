import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { listSystems, type PalGateSystem } from '../../data/palgateSystems';
import { loadGates, type GateConfig } from '../../data/gatesStore';
import { unlinkLinkedSystem } from '../../data/unlinkSystem';
import { appendEvent } from '../../data/eventLog';
import {
  goToGatesList,
  resetToHubAfterInvite,
} from '../../navigation/hubNavigation';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  acceptInvite,
  declineInvite,
  getInviteByCode,
  syncRevokedShares,
  type InviteDoc,
} from '../../share/invites';
import {
  inviteDisplayName,
  isValidInviteCode,
  normalizeInviteCode,
  partitionInviteGates,
  type SharedGatePayload,
} from '../../share/inviteLogic';
import { BarrierMark } from '../components/BarrierMark';
import { BusySheet, ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { FormSheet } from '../components/FormSheet';
import { HeaderIconButton, NavHeader } from '../components/NavHeader';
import { IconQr, IconSettings, IconUnlink } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';
import { isolateBidiText } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'GateSystems'>;

export function GateSystemsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { isRtl, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const auth = useAuth();
  const { user } = auth;
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [systems, setSystems] = useState<PalGateSystem[]>([]);
  const [gates, setGates] = useState<GateConfig[]>([]);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );
  const [unlinkId, setUnlinkId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    invite: InviteDoc & { code: string };
    declineOnCancel: boolean;
  } | null>(null);

  const reload = useCallback(async () => {
    const [sys, local] = await Promise.all([listSystems(), loadGates()]);
    setSystems(sys);
    setGates(local);
    try {
      await syncRevokedShares();
      const after = await loadGates();
      setGates(after);
    } catch {
      // Offline is fine — local list still shows.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const empty = systems.length === 0;

  useLayoutEffect(() => {
    navigation.setOptions({
      header: (props) => (
        <NavHeader
          title={t('nav.gateSystems')}
          onBack={
            props.back ? () => props.navigation.goBack() : undefined
          }
          actions={
            <>
              <HeaderIconButton
                onPress={() => navigation.navigate('Settings')}
                accessibilityLabel={t('common.settings')}
              >
                <IconSettings color={colors.primary} />
              </HeaderIconButton>
              <HeaderIconButton
                wide
                onPress={() => setSignOutOpen(true)}
                accessibilityLabel={t('common.logOut')}
              >
                <Text style={styles.headerActionText}>{t('common.logOut')}</Text>
              </HeaderIconButton>
            </>
          }
        />
      ),
    });
  }, [colors.primary, navigation, styles, t]);

  const goScan = (purpose: 'primary' | 'additional') => {
    navigation.navigate('LinkAccount', { purpose });
  };

  const submitCode = async () => {
    setCodeError(null);
    const normalized = normalizeInviteCode(code);
    if (!isValidInviteCode(normalized)) {
      setCodeError(t('systems.codeInvalid'));
      return;
    }
    setBusy(true);
    try {
      const invite = await getInviteByCode(normalized);
      if (!invite) {
        setCodeError(t('share.errNoInvite'));
        return;
      }
      setCodeOpen(false);
      setCode('');
      setPreview({ invite, declineOnCancel: false });
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : t('systems.acceptFail'));
    } finally {
      setBusy(false);
    }
  };

  const invitedList = preview
    ? preview.invite.gates.length
      ? preview.invite.gates
      : [preview.invite.gate]
    : [];
  const partition = preview
    ? partitionInviteGates(invitedList, gates)
    : null;
  const allOwned = Boolean(partition && partition.toAdd.length === 0);

  const finishInviteHub = async () => {
    const [sys, local] = await Promise.all([listSystems(), loadGates()]);
    setSystems(sys);
    setGates(local);
    resetToHubAfterInvite(navigation, {
      gateCount: local.length,
      systemCount: sys.length,
    });
  };

  const acceptPreview = async () => {
    const pending = preview;
    if (!pending) return;
    setPreview(null);
    setBusy(true);
    try {
      await acceptInvite(pending.invite.code);
    } catch (e) {
      const local = await loadGates();
      if (local.length === 0) {
        setInfo({
          title: t('systems.invite'),
          message: e instanceof Error ? e.message : t('systems.couldNotAccept'),
        });
        setBusy(false);
        return;
      }
    }
    try {
      await finishInviteHub();
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
            <Text style={styles.kicker}>{t('systems.kicker')}</Text>
            <Text style={styles.title}>{t('systems.scanFirst')}</Text>
            <Text style={styles.body}>{t('systems.emptyBody')}</Text>
          </View>
        ) : (
          <Text
            style={[styles.sectionTitle, { writingDirection, textAlign }]}
          >
            {t('systems.linked')}
          </Text>
        )}

        {systems.map((sys) => (
          <View key={sys.id} style={styles.systemCard}>
            <Text
              style={[styles.systemLabel, { writingDirection, textAlign }]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {isolateBidiText(sys.label, isRtl)}
            </Text>
            <Text
              style={[styles.systemMeta, { writingDirection, textAlign }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {sys.origin === 'shared' ? t('systems.fromInvite') : t('systems.scannedHere')}
              {' · '}
              {String(sys.credentials.phoneNumber).slice(-4)}
            </Text>
            {sys.origin === 'linked' ? (
              <Pressable
                onPress={() => setUnlinkId(sys.id)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.unlinkBtn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('systems.unlink')}
              >
                <IconUnlink color={colors.danger} size={16} />
                <Text style={styles.unlinkText}>{t('systems.unlink')}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={() => goScan(empty ? 'primary' : 'additional')}
        >
          <IconQr color={colors.primaryOn} />
          <Text style={styles.primaryText}>
            {empty ? t('systems.scanQr') : t('systems.linkAnother')}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={() => {
            setCodeError(null);
            setCodeOpen(true);
          }}
        >
          <Text style={styles.secondaryText}>{t('systems.enterCode')}</Text>
        </Pressable>

        {gates.length > 0 || !empty ? (
          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
            onPress={() => goToGatesList(navigation)}
          >
            <Text style={styles.ghostText}>{t('systems.goToGates')}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
            onPress={() => setSignOutOpen(true)}
            accessibilityLabel={t('common.logOut')}
          >
            <Text style={styles.headerActionText}>{t('common.logOut')}</Text>
          </Pressable>
        )}

        <Text style={styles.footnote}>
          {user?.isRealAccount
            ? t('systems.signedInNote')
            : t('systems.guestNote')}
        </Text>
      </ScrollView>

      <FormSheet
        visible={codeOpen}
        title={t('systems.codeTitle')}
        message={t('systems.codeMsg')}
        fields={[
          {
            key: 'code',
            label: t('common.code'),
            value: code,
            onChange: setCode,
            placeholder: t('systems.codePlaceholder'),
            autoCapitalize: 'none',
          },
        ]}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.accept')}
        error={codeError}
        busy={busy}
        onCancel={() => setCodeOpen(false)}
        onConfirm={() => void submitCode()}
      />
      <ConfirmSheet
        visible={signOutOpen}
        title={t('account.logOutTitle')}
        message={t('account.signOutMsg')}
        cancelLabel={t('common.staySignedIn')}
        confirmLabel={t('common.logOut')}
        destructive
        onCancel={() => setSignOutOpen(false)}
        onConfirm={() => {
          setSignOutOpen(false);
          void auth.signOut();
        }}
      />
      <ConfirmSheet
        visible={unlinkId != null}
        icon={<IconUnlink color={colors.danger} />}
        title={t('systems.unlinkTitle')}
        message={t('systems.unlinkMsg')}
        cancelLabel={t('settings.keepLinked')}
        confirmLabel={t('systems.unlink')}
        destructive
        onCancel={() => setUnlinkId(null)}
        onConfirm={() => {
          const id = unlinkId;
          setUnlinkId(null);
          if (!id) return;
          void (async () => {
            await unlinkLinkedSystem(id);
            await appendEvent({
              kind: 'info',
              message: t('systems.unlinkedEvent'),
            });
            await reload();
          })();
        }}
      />
      <ConfirmSheet
        visible={preview != null}
        title={
          allOwned ? t('systems.allOwnedTitle') : t('systems.acceptTitle')
        }
        message={
          allOwned
            ? t('systems.allOwnedMsg')
            : preview
              ? preview.invite.gates.length > 1
                ? t('systems.acceptMany', {
                    count: preview.invite.gates.length,
                    name: preview.invite.fromName || t('systems.someone'),
                  })
                : t('systems.acceptOne', {
                    gate:
                      preview.invite.gate.nameOverride ||
                      preview.invite.gate.name,
                    name: preview.invite.fromName || t('systems.someone'),
                  })
              : ''
        }
        cancelLabel={
          preview?.declineOnCancel ? t('common.decline') : t('common.cancel')
        }
        confirmLabel={
          allOwned
            ? t('common.done')
            : partition && partition.alreadyHave.length > 0
              ? t('systems.acceptNew', { count: partition.toAdd.length })
              : t('common.accept')
        }
        onCancel={() => {
          const pending = preview;
          setPreview(null);
          if (pending?.declineOnCancel) {
            void declineInvite(pending.invite.code).then(() => reload());
          }
        }}
        onConfirm={() => void acceptPreview()}
      >
        {partition ? (
          <InviteGateList
            toAdd={partition.toAdd}
            alreadyHave={partition.alreadyHave}
            isRtl={isRtl}
            writingDirection={writingDirection}
            textAlign={textAlign}
            colors={colors}
            t={t}
          />
        ) : null}
      </ConfirmSheet>
      <BusySheet
        visible={busy && !codeOpen}
        title={t('systems.invite')}
        message={t('systems.copying')}
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

function InviteGateList({
  toAdd,
  alreadyHave,
  isRtl,
  writingDirection,
  textAlign,
  colors,
  t,
}: {
  toAdd: SharedGatePayload[];
  alreadyHave: SharedGatePayload[];
  isRtl: boolean;
  writingDirection: 'rtl' | 'ltr';
  textAlign: 'right' | 'left';
  colors: ThemeColors;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (toAdd.length === 0 && alreadyHave.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      {toAdd.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: colors.primary,
              letterSpacing: 0.3,
              writingDirection,
              textAlign,
            }}
          >
            {t('systems.toAdd')}
          </Text>
          {toAdd.map((g) => (
            <Text
              key={`add:${g.deviceId}`}
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: colors.text,
                writingDirection,
                textAlign,
              }}
              numberOfLines={1}
            >
              {isolateBidiText(inviteDisplayName(g), isRtl)}
            </Text>
          ))}
        </View>
      ) : null}
      {alreadyHave.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: colors.muted,
              letterSpacing: 0.3,
              writingDirection,
              textAlign,
            }}
          >
            {t('systems.alreadyHave')}
          </Text>
          {alreadyHave.map((g) => (
            <Text
              key={`have:${g.deviceId}`}
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: colors.muted,
                writingDirection,
                textAlign,
              }}
              numberOfLines={1}
            >
              {isolateBidiText(inviteDisplayName(g), isRtl)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
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
      flexShrink: 1,
    },
    systemMeta: {
      fontSize: 13,
      color: c.muted,
      flexShrink: 1,
    },
    unlinkBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      marginTop: 8,
      paddingVertical: 4,
    },
    unlinkText: {
      fontSize: 14,
      fontWeight: '700',
      color: c.danger,
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
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    inviteTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
      flexShrink: 1,
    },
    inviteMeta: {
      fontSize: 13,
      color: c.muted,
      flexShrink: 1,
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
    headerActionText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 15,
    },
  });
}
