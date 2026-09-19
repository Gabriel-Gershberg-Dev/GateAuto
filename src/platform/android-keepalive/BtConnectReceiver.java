package com.gateauto.app.keepalive;

import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Manifest-registered car BT connect. Opens in-process (no JS FGS start).
 */
public class BtConnectReceiver extends BroadcastReceiver {
  private static final String TAG = "GateAutoKeepAlive";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null || !KeepAlivePrefs.isArmed(context)) return;
    HoldService.ensure(context);
    String action = intent.getAction();
    if (action == null) return;

    boolean connected = false;
    boolean disconnected = false;
    if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
      connected = true;
    } else if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
      disconnected = true;
    } else if ("android.bluetooth.a2dp.profile.action.CONNECTION_STATE_CHANGED".equals(action)
      || "android.bluetooth.headset.profile.action.CONNECTION_STATE_CHANGED".equals(action)) {
      int state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1);
      connected = state == BluetoothProfile.STATE_CONNECTED;
      disconnected = state == BluetoothProfile.STATE_DISCONNECTED;
    }
    if (!connected && !disconnected) return;

    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
    String name = null;
    String address = null;
    if (device != null) {
      try {
        address = device.getAddress();
        name = device.getName();
      } catch (SecurityException ignored) {
        address = device.getAddress();
      }
    }
    if ((name == null || name.trim().isEmpty()) && (address == null || address.trim().isEmpty())) {
      return;
    }

    // Keep the cached connected set exact. These are manifest broadcasts, so
    // they land even when the process was dead — which is what lets a later
    // locked-phone open answer "is the car connected?" with no Bluetooth read
    // at all.
    if (disconnected) {
      CarBluetoothState.recordDisconnected(context, address, name);
      Log.i(TAG, "native BT disconnect " + name + " " + address);
      return;
    }
    CarBluetoothState.recordConnected(context, address, name);

    Log.i(TAG, "native BT connect " + name + " " + address);
    final PendingResult pending = goAsync();
    final Context app = context.getApplicationContext();
    final String n = name;
    final String a = address;
    new Thread(
      () -> {
        try {
          PalGateNativeOpen.openFromBluetooth(app, n, a);
        } finally {
          new Handler(Looper.getMainLooper()).post(pending::finish);
        }
      },
      "gateauto-bt-open"
    ).start();
  }
}
