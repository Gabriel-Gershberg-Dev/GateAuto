package com.gateauto.app.keepalive;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

@ReactModule(name = KeepAliveModule.NAME)
public class KeepAliveModule extends ReactContextBaseJavaModule {
  public static final String NAME = "GateAutoKeepAlive";
  private static final long MIN_POLL_GAP_MS = 20_000L;
  /** Second chance if fused last-location is briefly empty after a region rewrite. */
  private static final long REGION_POLL_RETRY_MS = 1_500L;
  private static long lastPollAt;

  public KeepAliveModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  /**
   * Always use headless JS. DeviceEventEmitter is dropped when RN is paused
   * in the background even if hasActiveReactInstance() is still true.
   */
  public static void requestJsPoll(Context context) {
    long now = System.currentTimeMillis();
    if (lastPollAt > 0 && now - lastPollAt < MIN_POLL_GAP_MS) return;
    lastPollAt = now;
    KeepAliveService.startJs(context, "poll", null, null, null);
  }

  /**
   * Arm/disarm native auto-open. Does not wipe the regions JSON so Android Auto
   * can still list gates when Auto-open is off.
   */
  public static void applyArmed(Context context, boolean armed) {
    applyArmed(context, armed, false);
  }

  /**
   * @param startLocationFgs true only from the UI / Android Auto process.
   *     KeepAliveReceiver must never pass true (background FGS start is blocked).
   */
  public static void applyArmed(Context context, boolean armed, boolean startLocationFgs) {
    Context ctx = context.getApplicationContext();
    boolean wasArmed = KeepAlivePrefs.isArmed(ctx);
    KeepAlivePrefs.setArmed(ctx, armed);
    Log.i(
      NAME,
      "native armed="
        + armed
        + " regions="
        + GeofenceRegistrar.regionsArray(ctx).length()
        + " creds="
        + KeepAlivePrefs.hasCredentials(ctx)
        + " startFgs="
        + startLocationFgs
    );
    if (armed) {
      KeepAliveScheduler.start(ctx);
      // Never INITIAL_TRIGGER — already-outside EXIT would open every other pin.
      GeofenceRegistrar.register(ctx, false);
      if (startLocationFgs) {
        MonitoringService.start(ctx);
      }
      if (!wasArmed) {
        pollNearbySoon(ctx, "arm");
      }
    } else {
      KeepAliveScheduler.stop(ctx);
      MonitoringService.stop(ctx);
      GeofenceRegistrar.unregister(ctx);
    }
  }

  /**
   * In-process last-location poll. Does not start a location FGS (Android 12+
   * rejects background location FGS). {@link PalGateNativeOpen#pollNearby}
   * skips BT-required gates unless the listed car is connected.
   */
  static void pollNearbySoon(Context context, String reason) {
    final Context app = context.getApplicationContext();
    Log.i(NAME, "native poll after " + reason + " (already-inside, last loc, no new FGS)");
    new Thread(() -> PalGateNativeOpen.pollNearby(app), "gateauto-" + reason).start();
    new Handler(Looper.getMainLooper())
      .postDelayed(
        () ->
          new Thread(
            () -> PalGateNativeOpen.pollNearby(app),
            "gateauto-" + reason + "-retry"
          )
            .start(),
        REGION_POLL_RETRY_MS
      );
  }

  @ReactMethod
  public void setArmed(boolean armed, Promise promise) {
    try {
      ReactApplicationContext ctx = getReactApplicationContext();
      boolean ui = ctx.getCurrentActivity() != null;
      if (armed && !ui) {
        Log.w(
          NAME,
          "native FGS skip — no UI activity (not starting location FGS from background)"
        );
      }
      applyArmed(ctx, armed, armed && ui);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive", e);
    }
  }

  /** Start the native location FGS from the foreground UI process. */
  @ReactMethod
  public void startLocationFgs(Promise promise) {
    try {
      ReactApplicationContext ctx = getReactApplicationContext();
      if (!KeepAlivePrefs.isArmed(ctx)) {
        Log.w(NAME, "startLocationFgs skip — not armed");
        promise.resolve(false);
        return;
      }
      if (ctx.getCurrentActivity() == null) {
        Log.w(NAME, "startLocationFgs skip — no UI activity");
        promise.resolve(false);
        return;
      }
      MonitoringService.start(ctx);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_fgs", e);
    }
  }

  @ReactMethod
  public void isArmed(Promise promise) {
    try {
      promise.resolve(KeepAlivePrefs.isArmed(getReactApplicationContext()));
    } catch (Exception e) {
      promise.reject("keepalive_armed", e);
    }
  }

  @ReactMethod
  public void scheduleCooldownWake(double delayMs, Promise promise) {
    try {
      KeepAliveScheduler.scheduleCooldownWake(
        getReactApplicationContext(),
        (long) delayMs
      );
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_cooldown", e);
    }
  }

  @ReactMethod
  public void syncCredentials(String sessionToken, double phoneNumber, double tokenType, Promise promise) {
    try {
      KeepAlivePrefs.setCredentials(
        getReactApplicationContext(),
        sessionToken,
        (long) phoneNumber,
        (int) tokenType
      );
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_creds", e);
    }
  }

  @ReactMethod
  public void syncGateCredentialsJson(String json, Promise promise) {
    try {
      KeepAlivePrefs.setGateCredentialsJson(getReactApplicationContext(), json);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_gate_creds", e);
    }
  }

  @ReactMethod
  public void clearCredentials(Promise promise) {
    try {
      KeepAlivePrefs.clearCredentials(getReactApplicationContext());
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_creds", e);
    }
  }

  @ReactMethod
  public void tryClaimOpen(String gateId, double cooldownMs, Promise promise) {
    try {
      promise.resolve(
        KeepAlivePrefs.tryClaimOpen(
          getReactApplicationContext(),
          gateId,
          (long) cooldownMs
        )
      );
    } catch (Exception e) {
      promise.reject("keepalive_claim", e);
    }
  }

  @ReactMethod
  public void markOpened(String gateId, Promise promise) {
    try {
      boolean lockEngaged =
        KeepAlivePrefs.markOpened(getReactApplicationContext(), gateId);
      promise.resolve(lockEngaged);
    } catch (Exception e) {
      promise.reject("keepalive_opened", e);
    }
  }

  @ReactMethod
  public void syncSafetyLockSettings(double burstCount, double lockMs, Promise promise) {
    try {
      KeepAlivePrefs.setSafetyLockSettings(
        getReactApplicationContext(),
        (int) burstCount,
        (long) lockMs
      );
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_safety", e);
    }
  }

  @ReactMethod
  public void getSafetyLocksJson(Promise promise) {
    try {
      promise.resolve(
        KeepAlivePrefs.safetyLocksJson(getReactApplicationContext())
      );
    } catch (Exception e) {
      promise.reject("keepalive_locks", e);
    }
  }

  @ReactMethod
  public void clearSafetyLocks(Promise promise) {
    try {
      KeepAlivePrefs.clearSafetyLocks(getReactApplicationContext());
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_locks", e);
    }
  }

  @ReactMethod
  public void releaseClaim(String gateId, Promise promise) {
    try {
      KeepAlivePrefs.releaseClaim(gateId);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_claim", e);
    }
  }

  @ReactMethod
  public void getLastOpened(String gateId, Promise promise) {
    try {
      promise.resolve(
        (double) KeepAlivePrefs.lastOpenedAt(getReactApplicationContext(), gateId)
      );
    } catch (Exception e) {
      promise.reject("keepalive_opened", e);
    }
  }

  @ReactMethod
  public void startHold(String deviceId, String gateId, double holdMs, Promise promise) {
    try {
      PalGateNativeOpen.startHoldFromJs(
        getReactApplicationContext(),
        deviceId,
        gateId,
        (long) holdMs
      );
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_hold", e);
    }
  }

  @ReactMethod
  public void getHoldUntil(String deviceId, Promise promise) {
    try {
      promise.resolve(
        (double) KeepAlivePrefs.holdUntil(getReactApplicationContext(), deviceId)
      );
    } catch (Exception e) {
      promise.reject("keepalive_hold", e);
    }
  }

  @ReactMethod
  public void drainNativeEvents(Promise promise) {
    try {
      promise.resolve(KeepAlivePrefs.drainNativeEvents(getReactApplicationContext()));
    } catch (Exception e) {
      promise.reject("keepalive_events", e);
    }
  }

  @ReactMethod
  public void syncRegions(String json, Promise promise) {
    try {
      ReactApplicationContext ctx = getReactApplicationContext();
      GeofenceRegistrar.saveRegionsJson(ctx, json);
      if (KeepAlivePrefs.isArmed(ctx)) {
        // Geometry change rewrites (no INITIAL_TRIGGER). Rename / BT-off
        // leaves Play fences in place. Poll non-BT auto-on gates with last loc.
        GeofenceRegistrar.register(ctx, false);
        pollNearbySoon(ctx, "regions");
      }
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("keepalive_regions", e);
    }
  }

  @ReactMethod
  public void getRegionsJson(Promise promise) {
    try {
      promise.resolve(GeofenceRegistrar.regionsJson(getReactApplicationContext()));
    } catch (Exception e) {
      promise.reject("keepalive_regions", e);
    }
  }
}
