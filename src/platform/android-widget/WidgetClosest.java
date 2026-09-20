package com.gateauto.app.widget;

import android.content.Context;
import android.location.Location;

import com.gateauto.app.keepalive.GeofenceRegistrar;
import com.gateauto.app.keepalive.KeepAlivePrefs;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Rank linked, pinned gates for the home-screen widget.
 * Ignores Auto-open master ({@code armed}) and per-gate {@code enabled}.
 *
 * <p>Native display refresh never calls fused location. {@code loc} is the
 * WidgetRefresh cache (MonitoringService ticks / tap rank) or null. Null
 * falls back to last ranked closest, then most recently opened.
 */
public final class WidgetClosest {
  public static final class Ranked {
    public final String id;
    public final String name;
    public final Double meters;
    public final JSONObject gate;

    Ranked(String id, String name, Double meters, JSONObject gate) {
      this.id = id;
      this.name = name;
      this.meters = meters;
      this.gate = gate;
    }
  }

  private WidgetClosest() {}

  public static boolean isPinned(JSONObject gate) {
    if (gate == null) return false;
    double lat = gate.optDouble("lat", Double.NaN);
    double lng = gate.optDouble("lng", Double.NaN);
    return Double.isFinite(lat) && Double.isFinite(lng);
  }

  public static boolean isEligible(Context context, JSONObject gate) {
    if (!isPinned(gate)) return false;
    String id = gate.optString("id", "").trim();
    if (id.isEmpty()) return false;
    if (gate.optString("deviceId", "").trim().isEmpty()) return false;
    return KeepAlivePrefs.hasCredentialsForGate(context, id);
  }

  public static List<Ranked> rank(Context context, Location loc) {
    Context ctx = context.getApplicationContext();
    JSONArray arr = GeofenceRegistrar.regionsArray(ctx);
    List<JSONObject> eligible = new ArrayList<>();
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (isEligible(ctx, gate)) eligible.add(gate);
    }
    return rankEligible(ctx, eligible, loc, KeepAlivePrefs.widgetLastClosest(ctx));
  }

  static List<Ranked> rankEligible(
    Context context,
    List<JSONObject> eligible,
    Location loc,
    String lastClosestId
  ) {
    if (eligible == null || eligible.isEmpty()) return Collections.emptyList();
    boolean hasFix = loc != null
      && Double.isFinite(loc.getLatitude())
      && Double.isFinite(loc.getLongitude());
    List<Ranked> out = new ArrayList<>();
    if (hasFix) {
      float[] buf = new float[1];
      for (JSONObject gate : eligible) {
        Location.distanceBetween(
          loc.getLatitude(),
          loc.getLongitude(),
          gate.optDouble("lat"),
          gate.optDouble("lng"),
          buf
        );
        String id = gate.optString("id", "").trim();
        out.add(new Ranked(id, GeofenceRegistrar.displayLabel(gate), (double) buf[0], gate));
      }
      Collections.sort(out, new Comparator<Ranked>() {
        @Override
        public int compare(Ranked a, Ranked b) {
          int dm = Double.compare(a.meters, b.meters);
          if (dm != 0) return dm;
          long ao = KeepAlivePrefs.lastOpenedAt(context, a.id);
          long bo = KeepAlivePrefs.lastOpenedAt(context, b.id);
          if (ao != bo) return Long.compare(bo, ao);
          return a.id.compareTo(b.id);
        }
      });
      return out;
    }

    String last = lastClosestId == null ? "" : lastClosestId.trim();
    JSONObject preferred = null;
    List<JSONObject> rest = new ArrayList<>();
    for (JSONObject gate : eligible) {
      String id = gate.optString("id", "").trim();
      if (preferred == null && !last.isEmpty() && last.equals(id)) {
        preferred = gate;
      } else {
        rest.add(gate);
      }
    }
    Collections.sort(rest, new Comparator<JSONObject>() {
      @Override
      public int compare(JSONObject a, JSONObject b) {
        String aid = a.optString("id", "");
        String bid = b.optString("id", "");
        long ao = KeepAlivePrefs.lastOpenedAt(context, aid);
        long bo = KeepAlivePrefs.lastOpenedAt(context, bid);
        if (ao != bo) return Long.compare(bo, ao);
        return aid.compareTo(bid);
      }
    });
    if (preferred != null) {
      out.add(new Ranked(
        preferred.optString("id", "").trim(),
        GeofenceRegistrar.displayLabel(preferred),
        null,
        preferred
      ));
    }
    for (JSONObject gate : rest) {
      out.add(new Ranked(
        gate.optString("id", "").trim(),
        GeofenceRegistrar.displayLabel(gate),
        null,
        gate
      ));
    }
    return out;
  }

  public static Ranked pick(List<Ranked> ranked, String requestedId) {
    if (ranked == null || ranked.isEmpty()) return null;
    String want = requestedId == null ? "" : requestedId.trim();
    if (!want.isEmpty()) {
      for (Ranked row : ranked) {
        if (want.equals(row.id)) return row;
      }
    }
    return ranked.get(0);
  }
}
