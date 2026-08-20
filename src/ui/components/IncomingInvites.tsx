import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NavigationProp } from '@react-navigation/native';
import type { GateConfig } from '../../data/gatesStore';
import { listSystems } from '../../data/palgateSystems';
import { loadGates } from '../../data/gatesStore';
import { isolateBidiText } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { resetToHubAfterInvite } from '../../navigation/hubNavigation';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  acceptInvite,
  declineInvite,
  type InviteDoc,
} from '../../share/invites';
import {
  inviteDisplayName,
  partitionInviteGates,
  type SharedGatePayload,
} from '../../share/inviteLogic';
import { BusySheet, ConfirmSheet, InfoSheet } from './ConfirmSheet';
import { Group, Hairline } from './Group';
import { IconChevronRight, IconShare } from '../icons';
import { useTheme } from '../ThemeProvider';
import { type ThemeColors } from '../theme';

type HubNav = NavigationProp<RootStackParamList>;

export function IncomingInvites({
  incoming,
  gates,
  navigation,
  onReload,
}: {
  incoming: Array<InviteDoc & { code: string }>;
  gates: GateConfig[];
  navigation: HubNav;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { isRtl, row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [preview, setPreview] = useState<{
    invite: InviteDoc & { code: string };
    declineOnCancel: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );

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

  if (incoming.length === 0 && preview == null && !busy && info == null) {
    return null;
  }

  return (
    <>
      {incoming.length > 0 ? (
        <>
          <Text style={[styles.sectionTitle, { writingDirection, textAlign }]}>
            {t('systems.waiting')}
          </Text>
          <Group>
            {incoming.map((inv, i) => (
              <View key={inv.code}>
                {i > 0 ? <Hairline /> : null}
                <Pressable
                  onPress={() =>
                    setPreview({ invite: inv, declineOnCancel: true })
                  }
                  style={({ pressed }) => [
                    styles.inviteRow,
                    { flexDirection: row },
                    pressed && { backgroundColor: colors.surfacePressed },
                  ]}
                >
                  <IconShare color={colors.primary} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text
                      style={[styles.inviteTitle, { writingDirection, textAlign }]}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                    >
                      {isolateBidiText(
                        inv.gates.length > 1
                          ? t('systems.gatesCount', { count: inv.gates.length })
                          : inv.gate.nameOverride ||
                              inv.gate.name ||
                              t('systems.sharedGate'),
                        isRtl,
                      )}
                    </Text>
                    <Text
                      style={[styles.inviteMeta, { writingDirection, textAlign }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {t('systems.fromSomeone', {
                        name: inv.fromName || t('systems.someone'),
                        code: inv.code,
                      })}
                    </Text>
                  </View>
                  <View style={isRtl ? { transform: [{ scaleX: -1 }] } : undefined}>
                    <IconChevronRight color={colors.muted} />
                  </View>
                </Pressable>
              </View>
            ))}
          </Group>
        </>
      ) : null}
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
            void declineInvite(pending.invite.code).then(() => onReload());
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
        visible={busy}
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
}): ReactNode {
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
    sectionTitle: {
      marginTop: 2,
      marginBottom: 2,
      fontSize: 13,
      fontWeight: '700',
      color: c.muted,
      letterSpacing: 0.4,
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
  });
}
