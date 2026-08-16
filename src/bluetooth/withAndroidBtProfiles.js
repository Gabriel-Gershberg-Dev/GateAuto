/**
 * Expo config plugin: adds GateAutoCarBluetooth native module that lists
 * devices connected over A2DP / HEADSET / GATT (typical car Bluetooth links)
 * and emits ACL / profile connection events for auto-open while monitoring.
 * react-native-bluetooth-classic alone only tracks RFCOMM sockets opened by the app
 * and ignores ACL_CONNECTED for DEVICE_CONNECTED.
 *
 * Requires: npx expo prebuild && npx expo run:android
 */
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = 'com/gateauto/app/bluetooth';
const MODULE_CLASS = 'GateAutoCarBluetoothModule';
const PACKAGE_CLASS = 'GateAutoCarBluetoothPackage';

const MODULE_JAVA = `package com.gateauto.app.bluetooth;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothHeadset;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Lists A2DP/HEADSET/GATT connected devices and emits connection events for
 * classic ACL + A2DP/HEADSET profile connects (typical car head-unit links).
 * react-native-bluetooth-classic ignores ACL_CONNECTED for DEVICE_CONNECTED.
 */
@ReactModule(name = GateAutoCarBluetoothModule.NAME)
public class GateAutoCarBluetoothModule extends ReactContextBaseJavaModule {
  public static final String NAME = "GateAutoCarBluetooth";
  public static final String EVENT_DEVICE_CONNECTED = "GateAutoBluetoothDeviceConnected";
  private static final String TAG = "GateAutoCarBt";

  private static final int[] PROFILES = new int[] {
    BluetoothProfile.A2DP,
    BluetoothProfile.HEADSET,
    BluetoothProfile.GATT
  };

  @Nullable
  private BroadcastReceiver connectionReceiver;
  private boolean listening = false;

  public GateAutoCarBluetoothModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }

  @Override
  public void invalidate() {
    stopConnectionListeningInternal();
    super.invalidate();
  }

  @Nullable
  private BluetoothAdapter getAdapter() {
    Context context = getReactApplicationContext();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      BluetoothManager manager =
        (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
      if (manager != null) {
        return manager.getAdapter();
      }
    }
    return BluetoothAdapter.getDefaultAdapter();
  }

  private WritableMap mapDevice(BluetoothDevice device) {
    WritableMap map = Arguments.createMap();
    String address = null;
    String name = null;
    try {
      address = device.getAddress();
      name = device.getName();
    } catch (SecurityException ignored) {
      // Missing BLUETOOTH_CONNECT — return address-only if possible.
    }
    if (name == null || name.trim().isEmpty()) {
      name = address != null ? address : "Bluetooth device";
    }
    map.putString("name", name);
    if (address != null) {
      map.putString("address", address);
      map.putString("id", address);
    }
    return map;
  }

  private void emitDeviceConnected(@Nullable BluetoothDevice device) {
    if (device == null) return;
    ReactApplicationContext context = getReactApplicationContext();
    if (context == null || !context.hasActiveReactInstance()) {
      Log.d(TAG, "Skip emit — React instance inactive");
      return;
    }
    try {
      context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
        .emit(EVENT_DEVICE_CONNECTED, mapDevice(device));
      Log.i(TAG, "Emitted " + EVENT_DEVICE_CONNECTED);
    } catch (Exception e) {
      Log.w(TAG, "Failed to emit device connected", e);
    }
  }

  private static IntentFilter connectionIntentFilter() {
    IntentFilter filter = new IntentFilter();
    filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
    filter.addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED);
    filter.addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED);
    return filter;
  }

  @ReactMethod
  public void startConnectionListening(Promise promise) {
    try {
      if (listening) {
        promise.resolve(true);
        return;
      }
      ReactApplicationContext context = getReactApplicationContext();
      connectionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
          if (intent == null) return;
          String action = intent.getAction();
          if (action == null) return;

          BluetoothDevice device = null;
          try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
              device = intent.getParcelableExtra(
                BluetoothDevice.EXTRA_DEVICE,
                BluetoothDevice.class
              );
            } else {
              device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            }
          } catch (Exception ignored) {
            device = null;
          }

          if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
            emitDeviceConnected(device);
            return;
          }

          if (BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED.equals(action)
              || BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED.equals(action)) {
            int state = intent.getIntExtra(
              BluetoothProfile.EXTRA_STATE,
              BluetoothProfile.STATE_DISCONNECTED
            );
            if (state == BluetoothProfile.STATE_CONNECTED) {
              emitDeviceConnected(device);
            }
          }
        }
      };

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(
          connectionReceiver,
          connectionIntentFilter(),
          Context.RECEIVER_NOT_EXPORTED
        );
      } else {
        context.registerReceiver(connectionReceiver, connectionIntentFilter());
      }
      listening = true;
      Log.i(TAG, "Connection listening started");
      promise.resolve(true);
    } catch (Exception e) {
      Log.w(TAG, "startConnectionListening failed", e);
      listening = false;
      connectionReceiver = null;
      promise.reject("bt_listen_failed", e);
    }
  }

  @ReactMethod
  public void stopConnectionListening(Promise promise) {
    try {
      stopConnectionListeningInternal();
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("bt_listen_stop_failed", e);
    }
  }

  private void stopConnectionListeningInternal() {
    if (!listening || connectionReceiver == null) {
      listening = false;
      connectionReceiver = null;
      return;
    }
    try {
      getReactApplicationContext().unregisterReceiver(connectionReceiver);
    } catch (Exception e) {
      Log.w(TAG, "unregisterReceiver failed", e);
    }
    connectionReceiver = null;
    listening = false;
    Log.i(TAG, "Connection listening stopped");
  }

  @ReactMethod
  public void getProfileConnectedDevices(Promise promise) {
    BluetoothAdapter adapter = getAdapter();
    if (adapter == null || !adapter.isEnabled()) {
      promise.resolve(Arguments.createArray());
      return;
    }

    Set<String> seen = new HashSet<>();
    WritableArray out = Arguments.createArray();
    Context context = getReactApplicationContext();

    for (int profile : PROFILES) {
      CountDownLatch latch = new CountDownLatch(1);
      AtomicReference<BluetoothProfile> proxyRef = new AtomicReference<>();

      boolean requested = adapter.getProfileProxy(
        context,
        new BluetoothProfile.ServiceListener() {
          @Override
          public void onServiceConnected(int connectedProfile, BluetoothProfile proxy) {
            proxyRef.set(proxy);
            latch.countDown();
          }

          @Override
          public void onServiceDisconnected(int disconnectedProfile) {
            // no-op
          }
        },
        profile
      );

      if (!requested) {
        continue;
      }

      try {
        latch.await(1500, TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }

      BluetoothProfile proxy = proxyRef.get();
      if (proxy == null) {
        continue;
      }

      try {
        List<BluetoothDevice> devices = proxy.getConnectedDevices();
        if (devices != null) {
          for (BluetoothDevice device : devices) {
            String address = device.getAddress();
            if (address == null || !seen.add(address)) {
              continue;
            }
            out.pushMap(mapDevice(device));
          }
        }
      } catch (SecurityException ignored) {
        // Missing BLUETOOTH_CONNECT — caller should request permissions first.
      } finally {
        adapter.closeProfileProxy(profile, proxy);
      }
    }

    promise.resolve(out);
  }
}
`;

const PACKAGE_JAVA = `package com.gateauto.app.bluetooth;

import androidx.annotation.NonNull;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class GateAutoCarBluetoothPackage implements ReactPackage {
  @NonNull
  @Override
  public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext reactContext) {
    List<NativeModule> modules = new ArrayList<>();
    modules.add(new GateAutoCarBluetoothModule(reactContext));
    return modules;
  }

  @NonNull
  @Override
  public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }
}
`;

function withAndroidSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const javaRoot = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...PACKAGE_PATH.split('/'),
      );
      fs.mkdirSync(javaRoot, { recursive: true });
      fs.writeFileSync(path.join(javaRoot, `${MODULE_CLASS}.java`), MODULE_JAVA);
      fs.writeFileSync(path.join(javaRoot, `${PACKAGE_CLASS}.java`), PACKAGE_JAVA);
      return cfg;
    },
  ]);
}

function withPackageRegistration(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const importLine =
      'import com.gateauto.app.bluetooth.GateAutoCarBluetoothPackage;';
    if (!contents.includes(importLine)) {
      // Insert import after package declaration (Kotlin or Java).
      if (/^package\s+[\w.]+;?\s*$/m.test(contents)) {
        contents = contents.replace(
          /^(package\s+[\w.]+;?\s*)$/m,
          `$1\n\n${importLine}`,
        );
      } else {
        contents = `${importLine}\n${contents}`;
      }
    }

    if (!contents.includes('GateAutoCarBluetoothPackage()')) {
      // Kotlin MainApplication (Expo default)
      if (contents.includes('PackageList(this).packages.apply')) {
        contents = contents.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          (match) =>
            `${match}\n              add(GateAutoCarBluetoothPackage())`,
        );
      } else if (contents.includes('packages.add(')) {
        contents = contents.replace(
          /packages\.add\([^)]+\);/,
          (match) => `${match}\n          packages.add(new GateAutoCarBluetoothPackage());`,
        );
      } else if (contents.includes('return packages')) {
        contents = contents.replace(
          /return packages;/,
          'packages.add(new GateAutoCarBluetoothPackage());\n      return packages;',
        );
      }
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

/** Mark BLUETOOTH_SCAN as never-for-location so Nearby Devices isn't tied to location. */
function withBluetoothScanNeverForLocation(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const permissions = manifest['uses-permission'] ?? [];
    let found = false;
    for (const entry of permissions) {
      if (entry?.$?.['android:name'] === 'android.permission.BLUETOOTH_SCAN') {
        entry.$['android:usesPermissionFlags'] = 'neverForLocation';
        entry.$['tools:node'] = 'replace';
        found = true;
      }
    }
    if (!found) {
      permissions.push({
        $: {
          'android:name': 'android.permission.BLUETOOTH_SCAN',
          'android:usesPermissionFlags': 'neverForLocation',
          'tools:node': 'replace',
        },
      });
    }
    manifest['uses-permission'] = permissions;
    if (!manifest.$) {
      manifest.$ = {};
    }
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    return cfg;
  });
}

function withAndroidBtProfiles(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_ADMIN',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.BLUETOOTH_SCAN',
  ]);
  config = withBluetoothScanNeverForLocation(config);
  config = withAndroidSources(config);
  config = withPackageRegistration(config);
  return config;
}

module.exports = createRunOncePlugin(
  withAndroidBtProfiles,
  'gateauto-android-bt-profiles',
  '1.1.0',
);
