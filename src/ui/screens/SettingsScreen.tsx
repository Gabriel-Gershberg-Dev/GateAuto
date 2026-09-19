import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
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
import {
  loadDevOptionsUnlocked,
  setDevOptionsUnlocked,
  verifyDevUnlockPassword,
} from '../../updates/devUnlock';
import { onDevVersionTap } from '../../updates/unlockLogic';
import { SHOW_EXPORT_UI } from '../flags';
import { AppearancePicker } from '../components/AppearancePicker';
import { AutoOpenSettings } from '../components/AutoOpenSettings';
import { SafetyLockSettings } from '../components/SafetyLockSettings';
import { BusySheet, ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { FormSheet } from '../components/FormSheet';
import { Group, Hairline } from '../components/Group';
import { LanguagePicker } from '../components/LanguagePicker';
import {
  IconBell,
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
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';
import { useRtlLayout } from '../../i18n/useRtlLayout';

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
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [devTaps, setDevTaps] = useState(0);
  const [devPasswordOpen, setDevPasswordOpen] = useState(false);
  const [devPassword, setDevPassword] = useState('');
  const [devPasswordError, setDevPasswordError] = useState<string | null>(null);
  const [turnOffDevOpen, setTurnOffDevOpen] = useState(false);

  const versionName = Constants.expoConfig?.version ?? '';
  const versionCode =
    Constants.expoConfig?.android?.versionCode ??
    (
      Constants.expoConfig?.extra as
        | { androidVersionCode?: number }
        | undefined
    )?.androidVersionCode ??
    '';

  useEffect(() => {
    let cancelled = false;
    void loadDevOptionsUnlocked().then((on) => {
      if (!cancelled) setDevUnlocked(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const showDevToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    }
  };

  const onVersionRowPress = () => {
    if (Platform.OS !== 'android') return;
    const { taps, result } = onDevVersionTap({
      unlocked: devUnlocked,
      tapsBefore: devTaps,
    });
    setDevTaps(taps);
    if (result.kind === 'already') {
      showDevToast(t('settings.devAlready'));
      return;
    }
    if (result.kind === 'countdown') {
      showDevToast(t('settings.devStepsAway', { count: result.remaining }));
      return;
    }
    if (result.kind === 'askPassword') {
      setDevPassword('');
      setDevPasswordError(null);
      setDevPasswordOpen(true);
    }
  };

  const submitDevPassword = () => {
    setDevPasswordError(null);
    void verifyDevUnlockPassword(devPassword).then((ok) => {
      if (!ok) {
        setDevPasswordError(t('settings.devPasswordWrong'));
        return;
      }
      void setDevOptionsUnlocked(true).then(() => {
        setDevUnlocked(true);
        setDevPasswordOpen(false);
        setDevPassword('');
        showDevToast(t('settings.devNow'));
      });
    });
  };

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
      <LanguagePicker resumeOnRtl="Settings" />

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
              icon={<IconBell color={colors.primary} />}
              label={t('settings.notifications')}
              detail={t('settings.notificationsDetail')}
              onPress={() => navigation.navigate('Notifications')}
              colors={colors}
            />
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
        {Platform.OS === 'android' && devUnlocked ? (
          <>
            <Hairline inset={56} />
            <View style={styles.betaNote}>
              <Text style={styles.betaTitle}>{t('settings.betaTitle')}</Text>
              <Text style={styles.betaDetail}>{t('settings.betaNote')}</Text>
            </View>
            <Hairline inset={56} />
            <SettingsRow
              icon={<IconDownload color={colors.primary} />}
              label={t('settings.checkBetaUpdate')}
              detail={t('settings.checkBetaUpdateDetail')}
              onPress={() => void checkAppUpdate('beta')}
              colors={colors}
            />
            <Hairline inset={56} />
            <SettingsRow
              icon={<IconShield color={colors.muted} />}
              label={t('settings.turnOffDev')}
              detail={t('settings.turnOffDevDetail')}
              onPress={() => setTurnOffDevOpen(true)}
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

      <Group>
        <SettingsRow
          icon={<IconShield color={colors.primary} />}
          label={t('settings.appVersion')}
          detail={
            versionCode
              ? `${versionName} (${versionCode})`
              : versionName
          }
          onPress={onVersionRowPress}
          colors={colors}
          showChevron={false}
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
    <ConfirmSheet
      visible={devPasswordOpen}
      title={t('settings.devPasswordTitle')}
      message={t('settings.devPasswordMsg')}
      cancelLabel={t('common.cancel')}
      confirmLabel={t('settings.devPasswordConfirm')}
      confirmDisabled={!devPassword}
      onCancel={() => {
        setDevPasswordOpen(false);
        setDevPassword('');
        setDevPasswordError(null);
      }}
      onConfirm={submitDevPassword}
    >
      <TextInput
        value={devPassword}
        onChangeText={(text) => {
          setDevPassword(text);
          if (devPasswordError) setDevPasswordError(null);
        }}
        placeholder={t('common.password')}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        secureTextEntry
        autoFocus
        onSubmitEditing={submitDevPassword}
        style={styles.devPasswordInput}
      />
      {devPasswordError ? (
        <Text style={styles.devPasswordError}>{devPasswordError}</Text>
      ) : null}
    </ConfirmSheet>
    <ConfirmSheet
      visible={turnOffDevOpen}
      title={t('settings.turnOffDevTitle')}
      message={t('settings.turnOffDevMsg')}
      cancelLabel={t('common.cancel')}
      confirmLabel={t('settings.turnOffDevConfirm')}
      onCancel={() => setTurnOffDevOpen(false)}
      onConfirm={() => {
        setTurnOffDevOpen(false);
        void setDevOptionsUnlocked(false).then(() => {
          setDevUnlocked(false);
          setDevTaps(0);
        });
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
  showChevron = true,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  onPress: () => void;
  colors: ThemeColors;
  destructive?: boolean;
  showChevron?: boolean;
}) {
  const { row, writingDirection, textAlign } = useRtlLayout();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.surfacePressed }}
      style={({ pressed }) => [
        {
          flexDirection: row,
          alignItems: 'center',
          gap: 14,
          paddingVertical: 16,
          paddingHorizontal: 16,
          backgroundColor: pressed ? colors.surfacePressed : colors.surface,
        },
      ]}
    >
      <View style={{ width: 28, alignItems: 'center', flexShrink: 0 }}>
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          numberOfLines={2}
          ellipsizeMode="tail"
          style={{
            fontSize: 17,
            fontWeight: '600',
            color: destructive ? colors.danger : colors.text,
            letterSpacing: -0.2,
            writingDirection,
            textAlign,
          }}
        >
          {label}
        </Text>
        <Text
          numberOfLines={3}
          ellipsizeMode="tail"
          style={{
            fontSize: 13,
            color: colors.muted,
            writingDirection,
            textAlign,
          }}
        >
          {detail}
        </Text>
      </View>
      {showChevron ? (
        <View style={{ flexShrink: 0 }}>
          <IconChevronRight
            color={destructive ? colors.danger : colors.muted}
          />
        </View>
      ) : null}
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
    betaNote: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 2,
      backgroundColor: c.surface,
    },
    betaTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: c.text,
      letterSpacing: -0.1,
    },
    betaDetail: {
      fontSize: 13,
      color: c.muted,
      lineHeight: 18,
    },
    devPasswordInput: {
      backgroundColor: c.background,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 16,
      color: c.text,
    },
    devPasswordError: {
      fontSize: 13,
      color: c.danger,
    },
  });
}
