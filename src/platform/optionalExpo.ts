/**
 * Soft wrappers for Expo modules that may be missing until a native rebuild.
 * Core Export/Import still works via selectable text + TextInput paste.
 *
 * Important: do not `require('expo-clipboard')` unless the native module is
 * present — the JS package throws during evaluation and can RedBox the app.
 */

type ClipboardModule = {
  setStringAsync: (text: string) => Promise<void>;
  getStringAsync: () => Promise<string>;
};

type KeepAwakeModule = {
  activateKeepAwakeAsync: (tag?: string) => Promise<void>;
  deactivateKeepAwake: (tag?: string) => void;
};

function hasNativeModule(name: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core') as {
      requireOptionalNativeModule: (moduleName: string) => unknown;
    };
    return requireOptionalNativeModule(name) != null;
  } catch {
    return false;
  }
}

function loadClipboard(): ClipboardModule | null {
  if (!hasNativeModule('ExpoClipboard')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-clipboard') as
      | ClipboardModule
      | { default: ClipboardModule };
    if (mod && typeof mod === 'object' && 'setStringAsync' in mod) {
      return mod;
    }
    return (mod as { default: ClipboardModule }).default ?? null;
  } catch {
    return null;
  }
}

function loadKeepAwake(): KeepAwakeModule | null {
  if (!hasNativeModule('ExpoKeepAwake')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-keep-awake') as
      | KeepAwakeModule
      | { default: KeepAwakeModule };
    if (mod && typeof mod === 'object' && 'activateKeepAwakeAsync' in mod) {
      return mod;
    }
    return (mod as { default: KeepAwakeModule }).default ?? null;
  } catch {
    return null;
  }
}

export const ClipboardApi: ClipboardModule | null = loadClipboard();
export const KeepAwakeApi: KeepAwakeModule | null = loadKeepAwake();
