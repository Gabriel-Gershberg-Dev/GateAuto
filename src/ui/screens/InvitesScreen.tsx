import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { isolateBidiText } from '../../i18n/bidi';
import { useRtlLayout } from '../../i18n/useRtlLayout';
import { inviteDisplayName } from '../../share/inviteLogic';
import {
  listOutgoingInvites,
  revokeInvite,
  type InviteDoc,
} from '../../share/invites';
import { ClipboardApi } from '../../platform/optionalExpo';
import { ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { Group, Hairline } from '../components/Group';
import { IconCopy } from '../icons';
import { useTheme } from '../ThemeProvider';
import { spacing, type ThemeColors } from '../theme';

type Invite = InviteDoc & { code: string };

export function InvitesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { isRtl, row, writingDirection, textAlign } = useRtlLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [open, setOpen] = useState<Invite | null>(null);
  const [revokeCode, setRevokeCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const all = await listOutgoingInvites();
      setInvites(
        all.sort((a, b) => {
          const at = a.createdAt?.toMillis?.() ?? 0;
          const bt = b.createdAt?.toMillis?.() ?? 0;
          return bt - at;
        }),
      );
      setFailed(false);
    } catch {
      setInvites([]);
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const copyCode = async (code: string) => {
    if (!ClipboardApi) return;
    await ClipboardApi.setStringAsync(code);
    setCopied(code);
  };

  const names = open
    ? (open.gates.length ? open.gates : [open.gate])
        .map((g) => inviteDisplayName(g))
        .filter(Boolean)
    : [];

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        {invites.length === 0 ? (
          <Text style={[styles.empty, { writingDirection, textAlign }]}>
            {failed ? t('share.errSignIn') : t('share.emptyInvites')}
          </Text>
        ) : (
          <Group>
            {invites.map((inv, i) => (
              <View key={inv.code}>
                {i > 0 ? <Hairline /> : null}
                <Pressable
                  onPress={() => setOpen(inv)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <View style={[styles.top, { flexDirection: row }]}>
                    <View style={[styles.codeLine, { flexDirection: row }]}>
                      <Text style={styles.code}>{inv.code}</Text>
                      <Pressable
                        onPress={() => void copyCode(inv.code)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t('share.copyCode')}
                      >
                        <IconCopy
                          color={copied === inv.code ? colors.primary : colors.muted}
                          size={18}
                        />
                      </Pressable>
                    </View>
                    {inv.status === 'pending' || inv.status === 'accepted' ? (
                      <Pressable
                        onPress={() => setRevokeCode(inv.code)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.revoke')}
                      >
                        <Text style={styles.revoke}>{t('common.revoke')}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={[styles.meta, { writingDirection, textAlign }]} numberOfLines={2}>
                    {t(`share.status_${inv.status}`)}
                    {' · '}
                    {t('gates.listCount', {
                      count: inv.gates.length || (inv.gate?.deviceId ? 1 : 0),
                    })}
                    {inv.toEmailLower ? ` · ${t('share.forEmail', { email: inv.toEmailLower })}` : ''}
                    {inv.acceptedByEmail
                      ? ` · ${t('share.usedBy', { email: inv.acceptedByEmail })}`
                      : ''}
                  </Text>
                </Pressable>
              </View>
            ))}
          </Group>
        )}
      </ScrollView>
      <InfoSheet
        visible={open != null}
        title={open?.code ?? ''}
        message={
          names.length
            ? names.map((name) => isolateBidiText(name, isRtl)).join('\n')
            : t('share.inviteGates')
        }
        onDismiss={() => setOpen(null)}
      />
      <ConfirmSheet
        visible={revokeCode != null}
        title={t('share.revokeTitle')}
        message={t('share.revokeMsg')}
        cancelLabel={t('common.keep')}
        confirmLabel={t('common.revoke')}
        destructive
        onCancel={() => setRevokeCode(null)}
        onConfirm={() => {
          const code = revokeCode;
          setRevokeCode(null);
          if (!code) return;
          void revokeInvite(code).then(() => reload());
        }}
      />
    </>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    page: {
      padding: spacing.md,
      paddingBottom: spacing.lg,
      backgroundColor: c.background,
      flexGrow: 1,
    },
    empty: {
      fontSize: 15,
      color: c.muted,
      textAlign: 'center',
      marginTop: spacing.lg,
    },
    row: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 4,
      backgroundColor: c.surface,
    },
    top: {
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    code: {
      fontSize: 17,
      fontWeight: '700',
      color: c.text,
      letterSpacing: 1,
    },
    codeLine: {
      alignItems: 'center',
      gap: 8,
    },
    revoke: {
      fontSize: 14,
      fontWeight: '700',
      color: c.danger,
    },
    meta: {
      fontSize: 13,
      color: c.muted,
    },
    pressed: {
      opacity: 0.88,
    },
  });
}
