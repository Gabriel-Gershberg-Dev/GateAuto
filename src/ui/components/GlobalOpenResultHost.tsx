import { StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OpenResultBanners, type OpenBanner } from './OpenResultBanners';
import { subscribeOpenResults } from '../openResultBus';

/** Mount once near app root so auto-open feedback is visible on any screen. */
export function GlobalOpenResultHost() {
  const insets = useSafeAreaInsets();
  const [banners, setBanners] = useState<OpenBanner[]>([]);
  const bottom = Math.max(insets.bottom, 8) + 8;

  useEffect(() => {
    return subscribeOpenResults((banner) => {
      setBanners((prev) => {
        const withoutSameGate = prev.filter((b) => b.gateId !== banner.gateId);
        return [banner, ...withoutSameGate].slice(0, 4);
      });
    });
  }, []);

  if (banners.length === 0) return null;

  return (
    <View style={[styles.host, { paddingBottom: bottom }]} pointerEvents="box-none">
      <OpenResultBanners
        banners={banners}
        placement="bottom"
        onDismiss={(id) =>
          setBanners((prev) => prev.filter((b) => b.id !== id))
        }
        autoHideMs={4500}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
  },
});
