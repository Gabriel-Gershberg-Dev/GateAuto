import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { dismissUpdateNotification } from '../../notifications/notify';
import {
  beginDownloadAndInstall,
  checkAppUpdate,
  dismissLaunchUpdatePrompt,
  requestInstallPermission,
  subscribeUpdateUi,
  type UpdateOffer,
} from '../../updates/checkUpdate';
import {
  UPDATE_NOTICE_KIND,
  notifyUpdateAvailable,
} from '../../updates/updateNotice';
import { BusySheet, ConfirmSheet, InfoSheet } from './ConfirmSheet';
import { IconDownload } from '../icons';
import { useTheme } from '../ThemeProvider';

/**
 * Offers a sideload APK update after auth is ready. Enter (cold start /
 * foreground) force-fetches Remote Config in the background so Auto-open
 * never waits. Settings still shows checking / up-to-date sheets.
 */
export function AppUpdateHost() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { ready } = useAuth();
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkingChannel, setCheckingChannel] = useState<'production' | 'beta'>(
    'production',
  );
  const [downloading, setDownloading] = useState(false);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );
  const [allowInstalls, setAllowInstalls] = useState(false);
  const handledResponse = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handleResponse = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handledResponse.current === id) return;
      const kind = response.notification.request.content.data?.kind;
      if (kind !== UPDATE_NOTICE_KIND) return;
      handledResponse.current = id;
      void checkAppUpdate('settings');
    };
    const sub =
      Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return subscribeUpdateUi((event) => {
      if (event.kind === 'checking') {
        setChecking(true);
        setCheckingChannel(event.channel);
        setOffer(null);
        return;
      }
      setChecking(false);
      if (event.kind === 'offer') {
        setOffer(event.offer);
        return;
      }
      if (event.kind === 'up-to-date') {
        setOffer(null);
        const beta = event.channel === 'beta';
        setInfo({
          title: t('update.upToDateTitle'),
          message: t(beta ? 'update.betaUpToDateMsg' : 'update.upToDateMsg', {
            name: event.versionName,
          }),
        });
        return;
      }
      setInfo({
        title: t('update.failedTitle'),
        message: event.message || t('update.failedMsg'),
      });
    });
  }, [t]);

  useEffect(() => {
    if (!ready || Platform.OS !== 'android') return;
    void checkAppUpdate('enter');
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') void checkAppUpdate('enter');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [ready]);

  const notes = offer?.remote.releaseNotes?.trim() ?? '';
  const versionName = offer?.remote.latestVersionName || String(offer?.remote.latestVersionCode ?? '');
  const betaOffer = offer?.channel === 'beta';
  const availableTitle = betaOffer
    ? t('update.betaAvailableTitle')
    : t('update.availableTitle');
  const message = notes
    ? t('update.availableMsg', {
        name: versionName,
        code: offer?.remote.latestVersionCode ?? 0,
        notes,
      })
    : t('update.availableMsgNoNotes', {
        name: versionName,
        code: offer?.remote.latestVersionCode ?? 0,
      });

  return (
    <>
      <ConfirmSheet
        visible={offer != null && !downloading && !allowInstalls}
        icon={<IconDownload color={colors.primary} />}
        title={availableTitle}
        message={message}
        cancelLabel={t('common.notNow')}
        confirmLabel={t('update.download')}
        onCancel={() => {
          const pending = offer;
          dismissLaunchUpdatePrompt();
          setOffer(null);
          if (pending) void notifyUpdateAvailable(pending);
        }}
        onConfirm={() => {
          const url = offer?.remote.apkUrl;
          if (!url) return;
          setDownloading(true);
          void dismissUpdateNotification();
          void beginDownloadAndInstall(url)
            .catch((e) => {
              if (e instanceof Error && e.message === 'ALLOW_INSTALLS') {
                setAllowInstalls(true);
                return;
              }
              setInfo({
                title: t('update.failedTitle'),
                message: e instanceof Error ? e.message : t('update.failedMsg'),
              });
            })
            .finally(() => setDownloading(false));
        }}
      />
      <ConfirmSheet
        visible={allowInstalls}
        title={t('update.allowInstallsTitle')}
        message={t('update.allowInstallsMsg')}
        cancelLabel={t('common.notNow')}
        confirmLabel={t('update.allowInstalls')}
        onCancel={() => {
          setAllowInstalls(false);
          dismissLaunchUpdatePrompt();
          setOffer(null);
        }}
        onConfirm={() => {
          setAllowInstalls(false);
          void requestInstallPermission();
        }}
      />
      <BusySheet
        visible={checking || downloading}
        title={
          checking
            ? checkingChannel === 'beta'
              ? t('settings.checkBetaUpdate')
              : t('settings.checkUpdate')
            : availableTitle
        }
        message={checking ? t('update.checking') : t('update.downloading')}
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
