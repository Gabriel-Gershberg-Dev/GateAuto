import { Linking, Platform, UIManager } from 'react-native';

export const STREET_VIEW_NATIVE = 'GateAutoStreetView';

export function hasNativeStreetView(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    const ui = UIManager as typeof UIManager & {
      hasViewManagerConfig?: (name: string) => boolean;
    };
    if (typeof ui.hasViewManagerConfig === 'function') {
      return ui.hasViewManagerConfig(STREET_VIEW_NATIVE);
    }
    return ui.getViewManagerConfig(STREET_VIEW_NATIVE) != null;
  } catch {
    return false;
  }
}

/** Opens Google Maps Street View without using the Android-restricted key. */
export async function openExternalStreetView(
  lat: number,
  lng: number,
): Promise<boolean> {
  const nativeUri = `google.streetview:cbll=${lat},${lng}`;
  const webUri = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  try {
    if (await Linking.canOpenURL(nativeUri)) {
      await Linking.openURL(nativeUri);
      return true;
    }
    await Linking.openURL(webUri);
    return true;
  } catch {
    return false;
  }
}
