package com.gateauto.app.keepalive;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Which car Bluetooth devices are connected right now, cached so that reading it
 * can never delay or block opening a gate.
 *
 * <p><b>Why this exists.</b> A car head unit connects over A2DP / HEADSET, and
 * {@link BluetoothManager#getConnectedDevices(int)} only answers for GATT — it
 * returns an empty list for the classic profiles, so a GATT-only query never
 * sees the car. The classic profiles can only be read through an async
 * {@link BluetoothProfile} proxy, and that proxy's {@code onServiceConnected}
 * callback is delivered on the <em>main looper</em>. Waiting for it inside the
 * open path is therefore unsound: on a cold, locked-phone geofence wake the main
 * looper is busy bringing the process up, so the wait either stalls the open or
 * times out — and a timed-out read is indistinguishable from "car not
 * connected", which silently refuses to open the gate. That is the failure this
 * class removes.
 *
 * <p><b>How.</b> The profile proxies are bound once when monitoring arms and
 * kept bound for as long as it stays armed, so there is never a bind-and-wait in
 * the open path. Between reads, {@link BtConnectReceiver} folds ACL and profile
 * connect/disconnect broadcasts into the set; those are manifest broadcasts, so
 * they keep the set exact even across process death. The set is persisted, so a
 * cold-started process starts from the last known truth instead of from
 * nothing. At open time {@link #match} only reads what is already there.
 *
 * <p><b>Tri-state.</b> {@link #match} answers {@link #CONNECTED},
 * {@link #NOT_CONNECTED} or {@link #UNKNOWN}. A positive match is trusted
 * immediately; a negative one — the answer that blocks an open — is only
 * returned when the set is known to be complete and recent. Everything else is
 * UNKNOWN, and the caller falls open on proximity. Mirrored by
 * {@code src/bluetooth/carBluetoothCache.ts} and pinned by
 * {@code tests/carBluetoothCache.test.ts}.
 */
public final class CarBluetoothState {
  /** The connection state could not be read. Callers must not block an open. */
  static final int UNKNOWN = -1;
  /** Read successfully; no listed car is connected. */
  static final int NOT_CONNECTED = 0;
  /** A listed car is connected. */
  static final int CONNECTED = 1;

  private static final String TAG = "GateAutoKeepAlive";

  /**
   * How long a full profile read stays authoritative on its own. ACL
   * connect/disconnect broadcasts keep the set exact in between, and every
   * monitoring tick re-primes, so this only backstops a broadcast we never saw.
   */
  static final long SEED_TTL_MS = 6L * 60L * 60_000L;

  /** How often {@link #prime} may retry while it cannot bind (BT off, no permission). */
  private static final long PRIME_RETRY_MS = 30_000L;
  /** A bind request that never called back may be re-issued after this. */
  private static final long BIND_RETRY_MS = 60_000L;
  /** A proxy read slower than this is worth knowing about — it must never gate an open. */
  private static final long SLOW_READ_LOG_MS = 250L;

  /** The profiles a car head unit actually connects over. */
  private static final int[] CAR_PROFILES = {
    BluetoothProfile.A2DP,
    BluetoothProfile.HEADSET,
  };

  private static final Object LOCK = new Object();

  /** key (normalized address, else lowercased name) → display name, may be null. */
  private static final Map<String, String> connected = new LinkedHashMap<>();
  /** Bound car profile proxies, kept for the lifetime of the armed process. */
  private static final Map<Integer, BluetoothProfile> proxies = new HashMap<>();
  /** Profile → elapsed time a bind was requested, so a dead bind can be retried. */
  private static final Map<Integer, Long> binding = new HashMap<>();

  private static boolean seeded;
  private static long seededAt;
  private static boolean restored;
  private static long lastPrimeAt;

  private CarBluetoothState() {}

  /**
   * Bind the car profile proxies (async — never waited on) and refresh the
   * cached set. Safe and cheap to call from anywhere, including the main thread
   * and every monitoring tick: it returns immediately once the proxies are up.
   */
  static void prime(Context context) {
    if (context == null) return;
    long now = SystemClock.elapsedRealtime();
    synchronized (LOCK) {
      if (proxies.size() >= CAR_PROFILES.length) return;
      if (lastPrimeAt > 0 && now - lastPrimeAt < PRIME_RETRY_MS) return;
      lastPrimeAt = now;
    }
    final Context app = context.getApplicationContext();
    new Thread(() -> primeNow(app), "gateauto-bt-prime").start();
  }

  private static void primeNow(Context app) {
    restore(app);
    BluetoothAdapter adapter = adapter(app);
    if (adapter == null || !adapter.isEnabled()) return;
    if (!AutoOpenPermissionStatus.bluetoothConnectGranted(app)) {
      Log.i(TAG, "car BT prime skipped — BLUETOOTH_CONNECT not granted");
      return;
    }
    long now = SystemClock.elapsedRealtime();
    for (int profile : CAR_PROFILES) {
      synchronized (LOCK) {
        if (proxies.containsKey(profile)) continue;
        Long since = binding.get(profile);
        if (since != null && now - since < BIND_RETRY_MS) continue;
        binding.put(profile, now);
      }
      bind(app, adapter, profile);
    }
    resweep(app);
  }

  private static void bind(Context app, BluetoothAdapter adapter, int profile) {
    boolean requested = false;
    try {
      requested =
        adapter.getProfileProxy(
          app,
          new BluetoothProfile.ServiceListener() {
            @Override
            public void onServiceConnected(int p, BluetoothProfile proxy) {
              synchronized (LOCK) {
                proxies.put(p, proxy);
                binding.remove(p);
              }
              Log.i(TAG, "car BT profile proxy bound (" + p + ")");
              // This callback is delivered on the main looper — read the devices
              // on a worker so the very thread a cold wake needs stays free.
              new Thread(() -> resweep(app), "gateauto-bt-seed").start();
            }

            @Override
            public void onServiceDisconnected(int p) {
              synchronized (LOCK) {
                proxies.remove(p);
                binding.remove(p);
                // The stack went away; an empty read is no longer trustworthy.
                seeded = false;
              }
              Log.i(TAG, "car BT profile proxy lost (" + p + ")");
            }
          },
          profile
        );
    } catch (Exception e) {
      Log.w(TAG, "car BT getProfileProxy failed (" + profile + ")", e);
    }
    if (!requested) {
      synchronized (LOCK) {
        binding.remove(profile);
      }
    }
  }

  /** Drop the proxies and the cached set. Called when Auto-open is disarmed. */
  static void release(Context context) {
    List<Map.Entry<Integer, BluetoothProfile>> bound;
    synchronized (LOCK) {
      bound = new ArrayList<>(proxies.entrySet());
      proxies.clear();
      binding.clear();
      connected.clear();
      seeded = false;
      seededAt = 0L;
      lastPrimeAt = 0L;
    }
    BluetoothAdapter adapter = context == null ? null : adapter(context);
    if (adapter != null) {
      for (Map.Entry<Integer, BluetoothProfile> entry : bound) {
        try {
          adapter.closeProfileProxy(entry.getKey(), entry.getValue());
        } catch (Exception ignored) {
          // ignore
        }
      }
    }
    if (context != null) {
      KeepAlivePrefs.clearCarBtSnapshot(context);
    }
  }

  /**
   * Is a listed car connected? Instant: this reads proxies that are already
   * bound plus the cached set, and never binds, waits or touches the main
   * looper.
   *
   * @param wantAddr normalized addresses of the gate's listed cars
   * @param wantName lowercased names of the gate's listed cars
   */
  static int match(Context context, Set<String> wantAddr, Set<String> wantName) {
    if (context == null) return UNKNOWN;
    Context app = context.getApplicationContext();
    // Android 12+ hands back empty lists without BLUETOOTH_CONNECT, which reads
    // exactly like "car not connected".
    if (!AutoOpenPermissionStatus.bluetoothConnectGranted(app)) return UNKNOWN;
    BluetoothAdapter adapter = adapter(app);
    if (adapter == null) return UNKNOWN;
    // Bluetooth is off, so the car cannot be connected over it. That is a real
    // answer, not a failed read, and it outranks anything still in the cache.
    if (!adapter.isEnabled()) return NOT_CONNECTED;
    restore(app);
    // A bound proxy is a direct binder read — no bind, no callback, no wait.
    if (hasBoundProxy()) resweep(app);

    boolean matched;
    boolean trustEmpty;
    synchronized (LOCK) {
      matched = matchesLocked(wantAddr, wantName);
      trustEmpty = seeded && System.currentTimeMillis() - seededAt <= SEED_TTL_MS;
    }
    if (matched) return CONNECTED;
    if (trustEmpty) return NOT_CONNECTED;
    // Never seen a complete read — fall open on proximity and get ready for next
    // time rather than refuse to open the gate.
    prime(app);
    return UNKNOWN;
  }

  /** Short description of why {@link #match} answered the way it did, for logs. */
  static String describe() {
    int devices;
    int bound;
    boolean seed;
    long age;
    synchronized (LOCK) {
      devices = connected.size();
      bound = proxies.size();
      seed = seeded;
      age = seeded ? System.currentTimeMillis() - seededAt : -1L;
    }
    return "devices="
      + devices
      + " proxies="
      + bound
      + " seeded="
      + seed
      + (age >= 0 ? " seedAge=" + age + "ms" : "");
  }

  /** A car connected (ACL or profile broadcast). Positive evidence on its own. */
  static void recordConnected(Context context, String address, String name) {
    String key = keyFor(address, name);
    if (key.isEmpty()) return;
    Context app = context == null ? null : context.getApplicationContext();
    if (app != null) restore(app);
    synchronized (LOCK) {
      connected.put(key, name);
    }
    Log.i(TAG, "car BT cache + " + key);
    if (app != null) persist(app);
  }

  /** A car disconnected. Removes it so a later open is not gated on stale state. */
  static void recordDisconnected(Context context, String address, String name) {
    String key = keyFor(address, name);
    if (key.isEmpty()) return;
    Context app = context == null ? null : context.getApplicationContext();
    if (app != null) restore(app);
    boolean removed;
    synchronized (LOCK) {
      removed = connected.containsKey(key);
      connected.remove(key);
    }
    if (removed) Log.i(TAG, "car BT cache - " + key);
    if (app != null) persist(app);
  }

  private static boolean hasBoundProxy() {
    synchronized (LOCK) {
      return !proxies.isEmpty();
    }
  }

  /**
   * Rebuild the cached set from every bound proxy plus GATT. Replacing the set
   * wholesale (rather than merging) is what keeps a device that silently went
   * away from lingering as a false positive.
   */
  private static void resweep(Context app) {
    List<BluetoothProfile> bound;
    synchronized (LOCK) {
      bound = new ArrayList<>(proxies.values());
    }
    if (bound.isEmpty()) return;
    Map<String, String> fresh = new LinkedHashMap<>();
    long started = SystemClock.elapsedRealtime();
    for (BluetoothProfile proxy : bound) {
      List<BluetoothDevice> devices;
      try {
        devices = proxy.getConnectedDevices();
      } catch (SecurityException e) {
        // BLUETOOTH_CONNECT revoked mid-flight. Leave the previous set alone
        // rather than downgrade it to a "complete" empty read.
        Log.w(TAG, "car BT profile read denied", e);
        return;
      } catch (Exception e) {
        Log.w(TAG, "car BT profile read failed", e);
        return;
      }
      if (devices == null) continue;
      for (BluetoothDevice device : devices) put(fresh, device);
    }
    BluetoothManager mgr =
      (BluetoothManager) app.getSystemService(Context.BLUETOOTH_SERVICE);
    if (mgr != null) {
      for (int profile : new int[] {BluetoothProfile.GATT, BluetoothProfile.GATT_SERVER}) {
        try {
          for (BluetoothDevice device : mgr.getConnectedDevices(profile)) {
            put(fresh, device);
          }
        } catch (Exception ignored) {
          // GATT is a bonus; never fail the sweep over it.
        }
      }
    }
    long took = SystemClock.elapsedRealtime() - started;
    if (took >= SLOW_READ_LOG_MS) {
      Log.w(TAG, "car BT profile read took " + took + "ms");
    }
    synchronized (LOCK) {
      connected.clear();
      connected.putAll(fresh);
      seeded = true;
      seededAt = System.currentTimeMillis();
    }
    persist(app);
  }

  private static boolean matchesLocked(Set<String> wantAddr, Set<String> wantName) {
    if (wantAddr == null && wantName == null) return false;
    for (Map.Entry<String, String> entry : connected.entrySet()) {
      String key = entry.getKey();
      if (wantAddr != null && wantAddr.contains(key)) return true;
      // A device whose address could not be read is cached under its name.
      if (wantName != null && wantName.contains(key)) return true;
      String name = entry.getValue();
      if (wantName != null
        && name != null
        && wantName.contains(name.trim().toLowerCase(Locale.US))) {
        return true;
      }
    }
    return false;
  }

  private static void put(Map<String, String> into, BluetoothDevice device) {
    if (device == null) return;
    String address = null;
    String name = null;
    try {
      address = device.getAddress();
    } catch (Exception ignored) {
      // ignore
    }
    try {
      name = device.getName();
    } catch (SecurityException ignored) {
      // Name needs BLUETOOTH_CONNECT; the address alone still matches.
    }
    String key = keyFor(address, name);
    if (key.isEmpty()) return;
    into.put(key, name);
  }

  private static String keyFor(String address, String name) {
    String addr = normalizeAddr(address);
    if (!addr.isEmpty()) return addr;
    return name == null ? "" : name.trim().toLowerCase(Locale.US);
  }

  static String normalizeAddr(String raw) {
    return raw == null
      ? ""
      : raw.replace(":", "").replace("-", "").toLowerCase(Locale.US);
  }

  private static BluetoothAdapter adapter(Context context) {
    try {
      BluetoothManager mgr =
        (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
      BluetoothAdapter adapter = mgr != null ? mgr.getAdapter() : null;
      return adapter != null ? adapter : BluetoothAdapter.getDefaultAdapter();
    } catch (Exception e) {
      Log.w(TAG, "car BT adapter unavailable", e);
      return null;
    }
  }

  /** Pull the last known set off disk so a cold-started process is not blind. */
  private static void restore(Context app) {
    synchronized (LOCK) {
      if (restored) return;
      restored = true;
      try {
        JSONArray arr = new JSONArray(KeepAlivePrefs.carBtSnapshotJson(app));
        for (int i = 0; i < arr.length(); i++) {
          JSONObject row = arr.optJSONObject(i);
          if (row == null) continue;
          String key = row.optString("k", "").trim();
          if (key.isEmpty()) continue;
          String name = row.has("n") ? row.optString("n", null) : null;
          connected.put(key, name);
        }
      } catch (Exception ignored) {
        // A missing / corrupt snapshot just means we start unseeded.
      }
      long at = KeepAlivePrefs.carBtSnapshotAt(app);
      if (at > 0) {
        seeded = true;
        seededAt = at;
      }
    }
    Log.i(TAG, "car BT cache restored — " + describe());
  }

  private static void persist(Context app) {
    JSONArray arr = new JSONArray();
    long at;
    synchronized (LOCK) {
      for (Map.Entry<String, String> entry : connected.entrySet()) {
        try {
          JSONObject row = new JSONObject();
          row.put("k", entry.getKey());
          if (entry.getValue() != null) row.put("n", entry.getValue());
          arr.put(row);
        } catch (Exception ignored) {
          // skip this device
        }
      }
      at = seeded ? seededAt : 0L;
    }
    KeepAlivePrefs.setCarBtSnapshot(app, arr.toString(), at);
  }
}
