import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../auth/AuthProvider';
import { promptGoogleIdToken } from '../../auth/googleNative';
import { accountHeading } from '../../share/inviteLogic';
import { appendEvent } from '../../data/eventLog';
import { clearAllGates, loadGates } from '../../data/gatesStore';
import {
  clearAllSystems,
  listLinkedSystems,
  pruneUnusedSharedSystems,
} from '../../data/palgateSystems';
import { tryStopGeofencing, trySyncGeofences } from '../../integrations/optionalNative';
import { goToGateSystems } from '../../navigation/hubNavigation';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { checkAppUpdate } from '../../updates/checkUpdate';
import { SHOW_EXPORT_UI } from '../flags';
import { AppearancePicker } from '../components/AppearancePicker';
import { AutoOpenSettings } from '../components/AutoOpenSettings';
import { SafetyLockSettings } from '../components/SafetyLockSettings';
import { BusySheet, ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { FormSheet } from '../components/FormSheet';
import { Group, Hairline } from '../components/Group';
import { LanguagePicker } from '../components/LanguagePicker';
import {
  IconChevronRight,
  IconDownload,
  IconExport,
  IconGoogleMark,
  IconPerson,
  IconQr,
  IconShield,
  IconTrash,
} from '../icons';
import { useTheme } from '../ThemeProvider';
import { spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const auth = useAuth();

  const [removeAllOpen, setRemoveAllOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [name, setName] = useState(auth.user?.displayName ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );
  const [hasGate, setHasGate] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadGates().then((gates) => {
        if (cancelled) return;
        setHasGate(gates.length > 0);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const runRemoveAll = () => {
    setRemoveAllOpen(false);
    void (async () => {
      await tryStopGeofencing();
      await clearAllGates();
      const linked = await listLinkedSystems();
      if (linked.length === 0) {
        await clearAllSystems();
      } else {
        await pruneUnusedSharedSystems();
      }
      setHasGate(false);
      await trySyncGeofences();
      await appendEvent({ kind: 'info', message: t('settings.removedAllEvent') });
    })();
  };

  const heading = accountHeading({
    isRealAccount: Boolean(auth.user?.isRealAccount),
    displayName: auth.user?.displayName ?? null,
    email: auth.user?.email ?? null,
  });
  const headingLabel = heading.showUpgrade
    ? t('account.guest')
    : heading.label === 'Signed in'
      ? t('account.signedIn')
      : heading.label;
  const headingDetail = heading.showUpgrade
    ? t('account.guestDetail')
    : heading.detail === 'Google or email account'
      ? t('account.realDetail')
      : heading.detail;

  return (
    <>
    <ScrollView contentContainerStyle={styles.page}>
      <Group>
        <SettingsRow
          icon={<IconPerson color={colors.primary} />}
          label={headingLabel}
          detail={headingDetail}
          onPress={() => {
            if (heading.showUpgrade) {
              setUpgradeOpen(true);
              return;
            }
            setName(auth.user?.displayName ?? '');
            setEditNameOpen(true);
          }}
          colors={colors}
        />
        {heading.showUpgrade ? (
          <>
            <Hairline inset={56} />
            <SettingsRow
              icon={<IconGoogleMark color={colors.primary} />}
              label={t('account.upgrade')}
              detail={t('account.upgradeDetail')}
              onPress={() => setUpgradeOpen(true)}
              colors={colors}
            />
          </>
        ) : null}
        <Hairline inset={56} />
        <SettingsRow
          icon={<IconQr color={colors.primary} />}
          label={t('settings.gateSystems')}
          detail={t('settings.gateSystemsDetail')}
          onPress={() => goToGateSystems(navigation)}
          colors={colors}
        />
      </Group>

      {hasGate ? <AutoOpenSettings /> : null}
      {hasGate ? <SafetyLockSettings /> : null}
      <AppearancePicker />
      <LanguagePicker
        resumeOnRtl="Settings"
        onRtlMayNeedRestart={() =>
          setInfo({
            title: t('lang.restartTitle'),
            message: t('lang.restartBody'),
          })
        }
      />

      <Group>
        <SettingsRow
          icon={<IconShield color={colors.primary} />}
          label={t('settings.permissions')}
          detail={t('settings.permissionsDetail')}
          onPress={() => navigation.navigate('Permissions')}
          colors={colors}
        />
        {Platform.OS === 'android' ? (
          <>
            <Hairline inset={56} />
            <SettingsRow
              icon={<IconDownload color={colors.primary} />}
              label={t('settings.checkUpdate')}
              detail={t('settings.checkUpdateDetail')}
              onPress={() => void checkAppUpdate('settings')}
              colors={colors}
            />
          </>
        ) : null}
        {SHOW_EXPORT_UI ? (
          <>
            <Hairline inset={56} />
            <SettingsRow
              icon={<IconExport color={colors.primary} />}
              label={t('settings.export')}
              detail={t('settings.exportDetail')}
              onPress={() => navigation.navigate('ExportAccount')}
              colors={colors}
            />
          </>
        ) : null}
      </Group>

      <Group>
        {hasGate ? (
          <>
            <SettingsRow
              icon={<IconTrash color={colors.danger} />}
              label={t('settings.removeAll')}
              detail={t('settings.removeAllDetail')}
              onPress={() => setRemoveAllOpen(true)}
              colors={colors}
              destructive
            />
            <Hairline inset={56} />
          </>
        ) : null}
        <SettingsRow
          icon={<IconPerson color={colors.danger} />}
          label={t('common.signOut')}
          detail={t('account.signOutDetail')}
          onPress={() => setSignOutOpen(true)}
          colors={colors}
          destructive
        />
      </Group>
    </ScrollView>
    <ConfirmSheet
      visible={removeAllOpen}
      icon={<IconTrash color={colors.danger} />}
      title={t('settings.removeAllTitle')}
      message={t('settings.removeAllMsg')}
      cancelLabel={t('settings.keepGates')}
      confirmLabel={t('settings.removeAll')}
      destructive
      onCancel={() => setRemoveAllOpen(false)}
      onConfirm={runRemoveAll}
    />
    <ConfirmSheet
      visible={signOutOpen}
      title={t('account.signOutTitle')}
      message={t('account.signOutMsg')}
      cancelLabel={t('common.staySignedIn')}
      confirmLabel={t('common.signOut')}
      destructive
      onCancel={() => setSignOutOpen(false)}
      onConfirm={() => {
        setSignOutOpen(false);
        void auth.signOut();
      }}
    />
    <FormSheet
      visible={editNameOpen}
      title={t('account.editNameTitle')}
      message={t('account.editNameMsg')}
      fields={[
        {
          key: 'name',
          label: t('common.name'),
          value: name,
          onChange: setName,
          placeholder: t('auth.yourName'),
          autoCapitalize: 'words',
        },
      ]}
      cancelLabel={t('common.cancel')}
      confirmLabel={t('common.save')}
      busy={busy && editNameOpen}
      error={upgradeError}
      onCancel={() => {
        setEditNameOpen(false);
        setUpgradeError(null);
      }}
      onConfirm={() => {
        setUpgradeError(null);
        setBusy(true);
        void auth
          .updateDisplayName(name)
          .then(() => {
            setEditNameOpen(false);
            setInfo({
              title: t('account.editNameTitle'),
              message: t('account.nameSaved'),
            });
          })
          .catch((e) =>
            setUpgradeError(
              e instanceof Error ? e.message : t('account.upgradeFailed'),
            ),
          )
          .finally(() => setBusy(false));
      }}
    />
    <FormSheet
      visible={upgradeOpen}
      title={t('account.upgradeGuest')}
      message={t('account.upgradeGuestMsg')}
      fields={[
        {
          key: 'name',
          label: t('common.name'),
          value: name,
          onChange: setName,
          placeholder: t('auth.yourName'),
          autoCapitalize: 'words',
        },
        {
          key: 'email',
          label: t('common.email'),
          value: email,
          onChange: setEmail,
          placeholder: 'you@email.com',
          keyboardType: 'email-address',
        },
        {
          key: 'password',
          label: t('common.password'),
          value: password,
          onChange: setPassword,
          placeholder: t('auth.passwordMin'),
          secureTextEntry: true,
        },
      ]}
      extra={
        <Pressable
          onPress={() => {
            if (!auth.googleClientConfigured) {
              setInfo({
                title: t('common.google'),
                message: t('account.googleSetup'),
              });
              return;
            }
            setUpgradeOpen(false);
            setBusy(true);
            void promptGoogleIdToken()
              .then((idToken) => {
                if (!idToken) return;
                return auth.upgradeWithGoogle(idToken).then((result) =>
                  setInfo({
                    title: t('account.upgradedTitle'),
                    message: result.switchedAccount
                      ? t('account.upgradedGoogleSwitch')
                      : t('account.upgradedOk'),
                  }),
                );
              })
              .catch((e) =>
                setInfo({
                  title: t('common.google'),
                  message: e instanceof Error ? e.message : t('account.upgradeFailed'),
                }),
              )
              .finally(() => setBusy(false));
          }}
          style={{ paddingVertical: 8 }}
        >
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15 }}>
            {t('account.continueGoogle')}
          </Text>
        </Pressable>
      }
      cancelLabel={t('account.notNow')}
      confirmLabel={t('account.linkEmail')}
      error={upgradeError}
      busy={busy}
      onCancel={() => setUpgradeOpen(false)}
      onConfirm={() => {
        setUpgradeError(null);
        setBusy(true);
        void auth
          .upgradeWithEmail(name, email, password)
          .then((result) => {
            setUpgradeOpen(false);
            setInfo({
              title: t('account.upgradedTitle'),
              message: result.switchedAccount
                ? t('account.upgradedEmailSwitch')
                : t('account.upgradedOk'),
            });
          })
          .catch((e) =>
            setUpgradeError(e instanceof Error ? e.message : t('account.upgradeFailed')),
          )
          .finally(() => setBusy(false));
      }}
    />
    <BusySheet visible={busy && !upgradeOpen && !editNameOpen} title={t('nav.settings')} message={t('account.linking')} />
    <InfoSheet
      visible={info != null}
      title={info?.title ?? ''}
      message={info?.message ?? ''}
      onDismiss={() => setInfo(null)}
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
      <IconChevronRight
        color={destructive ? colors.danger : colors.muted}
      />
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
