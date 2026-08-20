import { I18nManager } from 'react-native';
import { useAppI18n } from './I18nProvider';
import { logicalFlexDirection } from './bidi';

export function useRtlLayout() {
  const { isRtl } = useAppI18n();
  return {
    isRtl,
    row: logicalFlexDirection(isRtl, I18nManager.isRTL),
    writingDirection: (isRtl ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
    textAlign: (isRtl ? 'right' : 'left') as 'right' | 'left',
  };
}
