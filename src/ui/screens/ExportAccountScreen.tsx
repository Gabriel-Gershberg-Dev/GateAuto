import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { serializeAccountExport } from '../../data/accountTransfer';
import { loadCredentials } from '../../data/credentials';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { ClipboardApi } from '../../platform/optionalExpo';
import { QrCard } from '../components/QrCard';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'ExportAccount'>;

export function ExportAccountScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const continueTo = route.params?.continueTo;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const credentials = await loadCredentials();
      if (cancelled) return;
      if (!credentials) {
        setError(t('export.noAccount'));
        return;
      }
      // Never appendEvent / log the export payload (contains session token).
      setPayload(serializeAccountExport(credentials));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onCopy = useCallback(async () => {
    if (!payload) return;
    if (!ClipboardApi) {
      setCopied(false);
      return;
    }
    await ClipboardApi.setStringAsync(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [payload]);

  const onContinue = useCallback(() => {
    if (continueTo === 'Permissions') {
      navigation.replace('Permissions');
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.replace('GatesList');
  }, [continueTo, navigation]);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.button} onPress={onContinue}>
          <Text style={styles.buttonText}>{t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!payload) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>{t('export.title')}</Text>
      <Text style={styles.body}>{t('export.body')}</Text>

      <QrCard value={payload} size={260} showValue={false} />

      {ClipboardApi ? (
        <Pressable style={styles.button} onPress={() => void onCopy()}>
          <Text style={styles.buttonText}>
            {copied ? t('common.copied') : t('export.copyJson')}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.body}>
          {t('export.noClipboard')}
        </Text>
      )}

      <Text style={styles.payload} selectable>
        {payload}
      </Text>

      <Pressable style={styles.buttonSecondary} onPress={onContinue}>
        <Text style={styles.buttonSecondaryText}>
          {continueTo === 'Permissions'
            ? t('export.continuePerms')
            : t('common.done')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: c.background,
    },
    container: {
      padding: spacing.lg,
      gap: spacing.md,
      paddingBottom: spacing.lg * 2,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: c.background,
      padding: spacing.lg,
      gap: spacing.md,
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
    payload: {
      fontSize: 12,
      color: c.muted,
      fontFamily: 'monospace',
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 0,
      borderRadius: radii.md,
      padding: spacing.md,
    },
    error: {
      color: c.danger,
      fontSize: 15,
      textAlign: 'center',
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
  });
}
