package com.gateauto.app.keepalive;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.Bundle;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/**
 * Google Places (New) autocomplete — the as-you-type list Google Maps shows,
 * including partial words and places, which the platform Geocoder cannot do.
 *
 * <p>Uses the same Android-restricted Maps key as the map. That restriction is
 * checked against the X-Android-Package / X-Android-Cert headers, so they are
 * sent with every call. One session token spans the typing and the final
 * details lookup, so Google bills the pick as a single session.
 */
final class PlacesSearch {
  private static final String AUTOCOMPLETE_URL =
    "https://places.googleapis.com/v1/places:autocomplete";
  private static final String DETAILS_URL = "https://places.googleapis.com/v1/places/";
  private static final int TIMEOUT_MS = 6_000;
  private static final double BIAS_RADIUS_M = 50_000.0;

  static final class Prediction {
    final String placeId;
    final String title;
    final String subtitle;

    Prediction(String placeId, String title, String subtitle) {
      this.placeId = placeId;
      this.title = title;
      this.subtitle = subtitle;
    }
  }

  static final class Place {
    final double latitude;
    final double longitude;
    final String formattedAddress;

    Place(double latitude, double longitude, String formattedAddress) {
      this.latitude = latitude;
      this.longitude = longitude;
      this.formattedAddress = formattedAddress;
    }
  }

  private static volatile String cachedCert;

  private PlacesSearch() {}

  static List<Prediction> autocomplete(
    Context context,
    String query,
    String sessionToken,
    String language,
    double biasLat,
    double biasLng
  ) throws Exception {
    JSONObject body = new JSONObject();
    body.put("input", query);
    if (language != null && !language.isEmpty()) body.put("languageCode", language);
    body.put("regionCode", "il");
    if (sessionToken != null && !sessionToken.isEmpty()) body.put("sessionToken", sessionToken);
    if (Double.isFinite(biasLat) && Double.isFinite(biasLng)) {
      JSONObject center = new JSONObject();
      center.put("latitude", biasLat);
      center.put("longitude", biasLng);
      JSONObject circle = new JSONObject();
      circle.put("center", center);
      circle.put("radius", BIAS_RADIUS_M);
      body.put("locationBias", new JSONObject().put("circle", circle));
    }
    JSONObject json = request(context, "POST", AUTOCOMPLETE_URL, body.toString(), null);
    List<Prediction> out = new ArrayList<>();
    JSONArray rows = json.optJSONArray("suggestions");
    if (rows == null) return out;
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.optJSONObject(i);
      JSONObject place = row == null ? null : row.optJSONObject("placePrediction");
      if (place == null) continue;
      String placeId = place.optString("placeId", "").trim();
      if (placeId.isEmpty()) continue;
      JSONObject format = place.optJSONObject("structuredFormat");
      String title = text(format == null ? null : format.optJSONObject("mainText"));
      String subtitle = text(format == null ? null : format.optJSONObject("secondaryText"));
      if (title.isEmpty()) title = text(place.optJSONObject("text"));
      if (title.isEmpty()) continue;
      out.add(new Prediction(placeId, title, subtitle));
    }
    return out;
  }

  static Place details(
    Context context,
    String placeId,
    String sessionToken,
    String language
  ) throws Exception {
    StringBuilder url = new StringBuilder(DETAILS_URL)
      .append(URLEncoder.encode(placeId, "UTF-8"));
    String sep = "?";
    if (language != null && !language.isEmpty()) {
      url.append(sep).append("languageCode=").append(URLEncoder.encode(language, "UTF-8"));
      sep = "&";
    }
    if (sessionToken != null && !sessionToken.isEmpty()) {
      url.append(sep).append("sessionToken=").append(URLEncoder.encode(sessionToken, "UTF-8"));
    }
    JSONObject json =
      request(context, "GET", url.toString(), null, "location,formattedAddress");
    JSONObject location = json.optJSONObject("location");
    if (location == null) throw new IllegalStateException("place has no location");
    double lat = location.optDouble("latitude", Double.NaN);
    double lng = location.optDouble("longitude", Double.NaN);
    if (!Double.isFinite(lat) || !Double.isFinite(lng)) {
      throw new IllegalStateException("place has no location");
    }
    return new Place(lat, lng, json.optString("formattedAddress", ""));
  }

  private static String text(JSONObject node) {
    return node == null ? "" : node.optString("text", "").trim();
  }

  private static JSONObject request(
    Context context,
    String method,
    String url,
    String body,
    String fieldMask
  ) throws Exception {
    String key = apiKey(context);
    if (key == null || key.isEmpty()) throw new IllegalStateException("no maps key");
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    try {
      conn.setRequestMethod(method);
      conn.setConnectTimeout(TIMEOUT_MS);
      conn.setReadTimeout(TIMEOUT_MS);
      conn.setRequestProperty("X-Goog-Api-Key", key);
      conn.setRequestProperty("X-Android-Package", context.getPackageName());
      String cert = signingCertSha1(context);
      if (cert != null) conn.setRequestProperty("X-Android-Cert", cert);
      if (fieldMask != null) conn.setRequestProperty("X-Goog-FieldMask", fieldMask);
      if (body != null) {
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        try (OutputStream os = conn.getOutputStream()) {
          os.write(body.getBytes(StandardCharsets.UTF_8));
        }
      }
      int status = conn.getResponseCode();
      InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
      String text = in == null ? "" : readAll(in);
      if (status >= 400) throw new IllegalStateException("places http " + status);
      return text.isEmpty() ? new JSONObject() : new JSONObject(text);
    } finally {
      conn.disconnect();
    }
  }

  private static String readAll(InputStream in) throws Exception {
    try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buf = new byte[4096];
      int n;
      while ((n = stream.read(buf)) > 0) out.write(buf, 0, n);
      return out.toString("UTF-8");
    }
  }

  private static String apiKey(Context context) throws Exception {
    ApplicationInfo info =
      context
        .getPackageManager()
        .getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
    Bundle meta = info.metaData;
    return meta == null ? null : meta.getString("com.google.android.geo.API_KEY");
  }

  @SuppressWarnings("deprecation")
  private static String signingCertSha1(Context context) {
    String cached = cachedCert;
    if (cached != null) return cached;
    try {
      PackageManager pm = context.getPackageManager();
      Signature[] signatures;
      if (Build.VERSION.SDK_INT >= 28) {
        PackageInfo pkg =
          pm.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        signatures =
          pkg.signingInfo == null ? null : pkg.signingInfo.getApkContentsSigners();
      } else {
        PackageInfo pkg =
          pm.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNATURES);
        signatures = pkg.signatures;
      }
      if (signatures == null || signatures.length == 0) return null;
      byte[] digest = MessageDigest.getInstance("SHA-1").digest(signatures[0].toByteArray());
      StringBuilder hex = new StringBuilder();
      for (byte b : digest) hex.append(String.format("%02X", b));
      cachedCert = hex.toString();
      return cachedCert;
    } catch (Exception e) {
      return null;
    }
  }
}
