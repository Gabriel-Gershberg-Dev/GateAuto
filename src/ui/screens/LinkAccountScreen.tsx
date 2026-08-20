import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { parseAccountExport } from '../../data/accountTransfer';
import { hasCredentials, saveCredentials } from '../../data/credentials';
import { hasAnySystem, upsertSystem } from '../../data/palgateSystems';
import { SHOW_EXPORT_UI } from '../flags';
import {
  startLinkingForegroundWatch,
  stopLinkingForegroundWatch,
} from '../../geo/linkingKeepAlive';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  clearLinkingStickyNotification,
  showLinkingStickyNotification,
} from '../../notifications/notify';
import { checkToken } from '../../palgate/api';
import {
  createLinkSession,
  parsePastedCredentials,
  waitForLinkedDevice,
  type LinkingProgress,
  type PollInfo,
} from '../../palgate/linking';
import { ClipboardApi, KeepAwakeApi } from '../../platform/optionalExpo';
import { QrCard } from '../components/QrCard';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'LinkAccount'>;

type Status =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'verifying' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

const KEEP_AWAKE_TAG = 'gateauto-linking';
const EMPTY_DEBUG: PollInfo = {
  attempt: 0,
  uuid: '',
  phase: 'ready',
  lastHttpStatus: null,
  lastSnippet: null,
  lastError: null,
  elapsedMs: null,
};

export function LinkAccountScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  const purpose = route.params?.purpose ?? 'primary';
  const [addingAnother, setAddingAnother] = useState(purpose === 'additional');
  const [alreadyLinked, setAlreadyLinked] = useState<boolean | null>(null);
  const [session, setSession] = useState<LinkingProgress | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [debug, setDebug] = useState<PollInfo>(EMPTY_DEBUG);
  const [showPaste, setShowPaste] = useState(false);
  const [showImport, setShowImport] = useState(true);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [pastePhone, setPastePhone] = useState('');
  const [pasteToken, setPasteToken] = useState('');
  const [pasteType, setPasteType] = useState('2');
  const [pasteError, setPasteError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({
      title: addingAnother ? t('link.another') : t('nav.linkPalGate'),
    });
  }, [addingAnother, navigation, t]);

  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<LinkingProgress | null>(null);
  const generationRef = useRef(0);
  const linkingRef = useRef(false);
  /** Mirrors status.kind for AppState reconnect without stale closures. */
  const statusKindRef = useRef<Status['kind']>('idle');
  statusKindRef.current = status.kind;

  const stopLinkingGuards = useCallback(async () => {
    try {
      KeepAwakeApi?.deactivateKeepAwake(KEEP_AWAKE_TAG);
    } catch {
      // ignore
    }
    await clearLinkingStickyNotification();
    await stopLinkingForegroundWatch();
  }, []);

  const startLinkingGuards = useCallback(async () => {
    try {
      await KeepAwakeApi?.activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    } catch (error) {
      console.warn('[GateAuto:link] keep-awake failed', error);
    }
    await showLinkingStickyNotification();
    // Android FGS (same pattern as monitoring) so long-poll can survive
    // switching to PalGate on this phone.
    await startLinkingForegroundWatch();
  }, []);

  const finishWithCredentials = useCallback(
    async (
      credentials: {
        phoneNumber: number;
        sessionToken: string;
        tokenType: number;
      },
      options?: { offerExport?: boolean },
    ) => {
      setStatus({ kind: 'verifying' });
      await stopLinkingGuards();
      if (addingAnother) {
        await upsertSystem(credentials, { origin: 'linked' });
      } else {
        await saveCredentials(credentials);
      }
      await checkToken(credentials);
      setStatus({ kind: 'success' });
      if (SHOW_EXPORT_UI && options?.offerExport && !addingAnother) {
        // Emulator/QR link: offer export before Permissions for phone transfer.
        navigationRef.current.replace('ExportAccount', {
          continueTo: 'Permissions',
        });
        return;
      }
      navigationRef.current.replace(addingAnother ? 'GatesList' : 'Permissions');
    },
    [addingAnother, stopLinkingGuards],
  );

  const startWait = useCallback(
    async (next: LinkingProgress, reason: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const generation = generationRef.current;

      sessionRef.current = next;
      setSession(next);
      setStatus({ kind: 'waiting' });
      setDebug({
        ...EMPTY_DEBUG,
        uuid: next.uuid,
        phase: 'ready',
        lastSnippet: `Ready to scan (${reason}) — long-poll starting…`,
      });
      linkingRef.current = true;
      await startLinkingGuards();

      console.log(`[GateAuto:link] startWait reason=${reason} uuid=${next.uuid}`);

      try {
        const credentials = await waitForLinkedDevice(next.uuid, {
          signal: controller.signal,
          onPoll: (info) => {
            if (controller.signal.aborted) return;
            if (generation !== generationRef.current) return;
            setDebug(info);
            setStatus({ kind: 'waiting' });
            console.log(
              `[GateAuto:link] poll #${info.attempt} phase=${info.phase} http=${info.lastHttpStatus ?? '-'} ${info.lastError ?? info.lastSnippet ?? ''}`,
            );
          },
        });

        if (controller.signal.aborted) return;
        if (generation !== generationRef.current) return;

        await finishWithCredentials(credentials, { offerExport: true });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (generation !== generationRef.current) return;
        const message =
          error instanceof Error ? error.message : t('link.linkFailed');
        console.log(`[GateAuto:link] failed: ${message}`);
        setStatus({ kind: 'error', message });
        await stopLinkingGuards();
      } finally {
        if (generation === generationRef.current) {
          linkingRef.current = false;
        }
      }
    },
    [finishWithCredentials, startLinkingGuards, stopLinkingGuards],
  );

  const startNewQr = useCallback(() => {
    generationRef.current += 1;
    const next = createLinkSession();
    void startWait(next, 'new QR');
  }, [startWait]);

  const retrySameUuid = useCallback(() => {
    const current = sessionRef.current;
    if (!current) {
      startNewQr();
      return;
    }
    generationRef.current += 1;
    void startWait(current, 'retry poll');
  }, [startNewQr, startWait]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const has = await hasAnySystem();
      if (cancelled) return;
      setAddingAnother(has);
      if (has) {
        setAlreadyLinked(false);
        startNewQr();
        return;
      }
      const linked = await hasCredentials();
      if (cancelled) return;
      setAlreadyLinked(linked);
      if (linked) {
        // Already linked — show Export / Import, do not start a new QR wait.
        return;
      }
      startNewQr();
    })();
    return () => {
      cancelled = true;
      generationRef.current += 1;
      abortRef.current?.abort();
      void stopLinkingGuards();
    };
    // Mount-only: startNewQr/stopLinkingGuards are stable enough for first paint;
    // re-running would abort an in-flight long-poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let leftActive = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') {
        leftActive = true;
        // Ensure FGS + sticky stay up while user is in PalGate.
        if (sessionRef.current && statusKindRef.current === 'waiting') {
          void startLinkingGuards();
        }
        return;
      }
      if (!leftActive) return;
      leftActive = false;
      // Same-phone scan backgrounds GateAuto; FGS may keep the poll alive.
      // If not, restart within ~1s after a short grace for an in-flight response.
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const genAtResume = generationRef.current;
      reconnectTimer = setTimeout(() => {
        if (generationRef.current !== genAtResume) return;
        const current = sessionRef.current;
        if (!current) return;
        const kind = statusKindRef.current;
        if (kind === 'success' || kind === 'verifying') return;
        // Restart when still waiting, or when background kill ended the loop
        // with an error / idle — user returning from PalGate should not stick.
        if (kind !== 'waiting' && kind !== 'error' && !linkingRef.current) {
          return;
        }
        console.log(
          `[GateAuto:link] App foreground — reconnecting poll (was ${kind})`,
        );
        generationRef.current += 1;
        void startWait(current, 'app foreground');
      }, 800);
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      sub.remove();
    };
  }, [startLinkingGuards, startWait]);

  const submitImport = useCallback(async () => {
    setImportError(null);
    const credentials = parseAccountExport(importJson);
    if (!credentials) {
      setImportError(
        t('link.needJson'),
      );
      return;
    }
    try {
      generationRef.current += 1;
      abortRef.current?.abort();
      await finishWithCredentials(credentials);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : t('link.importFailed'),
      );
    }
  }, [finishWithCredentials, importJson, t]);

  const pasteFromClipboard = useCallback(async () => {
    if (!ClipboardApi) {
      setImportError(t('link.longPressPaste'));
      return;
    }
    const text = await ClipboardApi.getStringAsync();
    if (text?.trim()) {
      setImportJson(text.trim());
      setImportError(null);
    } else {
      setImportError(t('link.clipboardEmpty'));
    }
  }, [t]);

  const submitPaste = useCallback(async () => {
    setPasteError(null);
    const credentials = parsePastedCredentials({
      phoneNumber: pastePhone,
      sessionToken: pasteToken,
      tokenType: pasteType,
    });
    if (!credentials) {
      setPasteError(t('link.needFields'));
      return;
    }
    try {
      generationRef.current += 1;
      abortRef.current?.abort();
      await finishWithCredentials(credentials);
    } catch (error) {
      setPasteError(
        error instanceof Error ? error.message : t('link.pasteFailed'),
      );
    }
  }, [finishWithCredentials, pastePhone, pasteToken, pasteType, t]);

  if (alreadyLinked === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (alreadyLinked) {
    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('link.alreadyTitle')}</Text>
        <Text style={styles.body}>{t('link.alreadyBody')}</Text>
        {SHOW_EXPORT_UI ? (
          <Pressable
            style={styles.button}
            onPress={() => navigation.navigate('ExportAccount')}
          >
            <Text style={styles.buttonText}>{t('link.exportAccount')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.buttonSecondary}
          onPress={() => navigation.replace('GatesList')}
        >
          <Text style={styles.buttonSecondaryText}>{t('link.goToGates')}</Text>
        </Pressable>

        <View style={styles.pasteBox}>
          <Text style={styles.debugTitle}>{t('link.importJson')}</Text>
          <Text style={styles.footnote}>{t('link.importFoot')}</Text>
          <TextInput
            style={[styles.input, styles.importInput]}
            placeholder='{"phoneNumber":…,"sessionToken":"…","tokenType":2}'
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            value={importJson}
            onChangeText={setImportJson}
          />
          {importError ? (
            <Text style={styles.statusErr}>{importError}</Text>
          ) : null}
          <Pressable
            style={styles.buttonSecondary}
            onPress={() => void pasteFromClipboard()}
          >
            <Text style={styles.buttonSecondaryText}>{t('link.pasteClipboard')}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => void submitImport()}>
            <Text style={styles.buttonText}>{t('link.showImport')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>
        {addingAnother ? t('link.another') : t('link.title')}
      </Text>
      <Text style={styles.body}>
        {addingAnother ? t('link.bodyAnother') : t('link.bodyPrimary')}
      </Text>
      <Text style={styles.body}>{t('link.emulatorNote')}</Text>

      {session ? (
        <QrCard value={session.qrPayload} size={320} showValue={false} />
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}

      {status.kind === 'waiting' && debug.phase === 'polling' ? (
        <Text style={styles.minimizeHint}>
          {t('link.minimize')}
        </Text>
      ) : status.kind === 'waiting' ? (
        <Text style={styles.footnote}>
          {t('link.waitPoll')}
        </Text>
      ) : null}

      <View style={styles.statusBox}>
        {status.kind === 'waiting' && (
          <Text style={styles.statusOk}>
            {debug.phase === 'polling'
              ? t('link.phasePolling')
              : t('link.phaseReady')}
          </Text>
        )}
        {status.kind === 'verifying' && (
          <Text style={styles.statusOk}>{t('link.verifying')}</Text>
        )}
        {status.kind === 'success' && (
          <Text style={styles.statusOk}>{t('link.success')}</Text>
        )}
        {status.kind === 'error' && (
          <Text style={styles.statusErr}>{status.message}</Text>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={startNewQr}>
          <Text style={styles.buttonText}>{t('link.newQr')}</Text>
        </Pressable>
        <Pressable style={styles.buttonSecondary} onPress={retrySameUuid}>
          <Text style={styles.buttonSecondaryText}>
            {t('link.retryPoll')}
          </Text>
        </Pressable>
        <Pressable
          style={styles.buttonSecondary}
          onPress={() => setShowImport((v) => !v)}
        >
          <Text style={styles.buttonSecondaryText}>
            {showImport ? t('link.hideImport') : t('link.showImport')}
          </Text>
        </Pressable>
        <Pressable
          style={styles.buttonSecondary}
          onPress={() => setShowPaste((v) => !v)}
        >
          <Text style={styles.buttonSecondaryText}>
            {showPaste ? t('link.hidePaste') : t('link.showPaste')}
          </Text>
        </Pressable>
      </View>

      {showImport && (
        <View style={styles.pasteBox}>
          <Text style={styles.debugTitle}>{t('link.importTitle')}</Text>
          <Text style={styles.footnote}>{t('link.importHelp')}</Text>
          <TextInput
            style={[styles.input, styles.importInput]}
            placeholder='{"phoneNumber":…,"sessionToken":"…","tokenType":2}'
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            value={importJson}
            onChangeText={setImportJson}
          />
          {importError ? (
            <Text style={styles.statusErr}>{importError}</Text>
          ) : null}
          <Pressable
            style={styles.buttonSecondary}
            onPress={() => void pasteFromClipboard()}
          >
            <Text style={styles.buttonSecondaryText}>{t('link.pasteClipboard')}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => void submitImport()}>
            <Text style={styles.buttonText}>{t('link.importContinue')}</Text>
          </Pressable>
        </View>
      )}

      {showPaste && (
        <View style={styles.pasteBox}>
          <Text style={styles.debugTitle}>
            {t('link.pasteTitle')}
          </Text>
          <TextInput
            style={styles.input}
            placeholder={t('link.phonePlaceholder')}
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            value={pastePhone}
            onChangeText={setPastePhone}
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            placeholder={t('link.tokenPlaceholder')}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            value={pasteToken}
            onChangeText={setPasteToken}
          />
          <TextInput
            style={styles.input}
            placeholder={t('link.typePlaceholder')}
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            value={pasteType}
            onChangeText={setPasteType}
          />
          {pasteError ? (
            <Text style={styles.statusErr}>{pasteError}</Text>
          ) : null}
          <Pressable style={styles.button} onPress={submitPaste}>
            <Text style={styles.buttonText}>{t('link.savePaste')}</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.footnote}>
        {t('link.footnote')}
      </Text>
    </ScrollView>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: c.background,
    },
    loading: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: c.background,
    },
    container: {
      padding: spacing.lg,
      gap: spacing.md,
      paddingBottom: spacing.lg * 2,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: c.text,
    },
    body: {
      fontSize: 15,
      color: c.muted,
      lineHeight: 22,
    },
    minimizeHint: {
      fontSize: 15,
      fontWeight: '600',
      color: c.primary,
      lineHeight: 22,
    },
    statusBox: {
      minHeight: 28,
      justifyContent: 'center',
    },
    statusOk: {
      fontSize: 15,
      color: c.primary,
      fontWeight: '600',
    },
    statusErr: {
      fontSize: 14,
      color: c.danger,
    },
    debugBox: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 0,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: 4,
    },
    debugTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: c.text,
      marginBottom: 4,
    },
    debugLine: {
      fontSize: 12,
      color: c.muted,
      fontFamily: 'monospace',
    },
    actions: {
      gap: spacing.sm,
    },
    button: {
      alignSelf: 'stretch',
      backgroundColor: c.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderRadius: radii.pill,
      alignItems: 'center',
    },
    buttonText: {
      color: c.primaryOn,
      fontWeight: '600',
    },
    buttonSecondary: {
      alignSelf: 'stretch',
      borderColor: c.primary,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderRadius: radii.pill,
      alignItems: 'center',
    },
    buttonSecondaryText: {
      color: c.primary,
      fontWeight: '600',
    },
    pasteBox: {
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 0,
      borderRadius: radii.md,
      padding: spacing.md,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: spacing.sm,
      color: c.text,
      backgroundColor: c.background,
    },
    importInput: {
      minHeight: 96,
      textAlignVertical: 'top',
      fontFamily: 'monospace',
      fontSize: 12,
    },
    footnote: {
      fontSize: 12,
      color: c.muted,
      lineHeight: 18,
    },
  });
}
