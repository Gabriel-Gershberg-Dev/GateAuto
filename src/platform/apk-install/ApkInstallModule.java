package com.gateauto.app.apkinstall;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.annotation.NonNull;
import androidx.core.content.FileProvider;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@ReactModule(name = ApkInstallModule.NAME)
public class ApkInstallModule extends ReactContextBaseJavaModule {
  public static final String NAME = "GateAutoApkInstall";
  private static final int MAX_BYTES = 180 * 1024 * 1024;
  private static final ExecutorService IO = Executors.newSingleThreadExecutor();
  private static final Handler MAIN = new Handler(Looper.getMainLooper());

  public ApkInstallModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void getInstalledVersionCode(Promise promise) {
    try {
      Context ctx = getReactApplicationContext();
      PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
      long code =
        Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
      promise.resolve((int) code);
    } catch (Exception e) {
      promise.reject("VERSION", e);
    }
  }

  @ReactMethod
  public void canRequestPackageInstalls(Promise promise) {
    try {
      Context ctx = getReactApplicationContext();
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.resolve(true);
        return;
      }
      promise.resolve(ctx.getPackageManager().canRequestPackageInstalls());
    } catch (Exception e) {
      promise.reject("INSTALL_PERM", e);
    }
  }

  @ReactMethod
  public void openInstallPermissionSettings(Promise promise) {
    try {
      Context ctx = getReactApplicationContext();
      Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
      intent.setData(Uri.parse("package:" + ctx.getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      Activity activity = getCurrentActivity();
      if (activity != null) {
        activity.startActivity(intent);
      } else {
        ctx.startActivity(intent);
      }
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("INSTALL_SETTINGS", e);
    }
  }

  @ReactMethod
  public void downloadAndInstall(String url, Promise promise) {
    if (url == null || !url.startsWith("https://")) {
      promise.reject("URL", "APK URL must be HTTPS");
      return;
    }
    IO.execute(() -> {
      HttpURLConnection conn = null;
      try {
        Context ctx = getReactApplicationContext();
        File dir = new File(ctx.getFilesDir(), "apks");
        if (!dir.exists() && !dir.mkdirs()) {
          throw new IllegalStateException("Could not create APK folder");
        }
        File apk = new File(dir, "update.apk");
        if (apk.exists() && !apk.delete()) {
          throw new IllegalStateException("Could not replace previous APK");
        }

        URL target = new URL(url);
        conn = open(target);
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) {
          throw new IllegalStateException("Download failed HTTP " + code);
        }
        long length = conn.getContentLengthLong();
        if (length > MAX_BYTES) {
          throw new IllegalStateException("APK is too large");
        }
        try (InputStream in = conn.getInputStream();
             FileOutputStream out = new FileOutputStream(apk)) {
          byte[] buf = new byte[8192];
          long written = 0;
          int n;
          while ((n = in.read(buf)) != -1) {
            written += n;
            if (written > MAX_BYTES) {
              throw new IllegalStateException("APK is too large");
            }
            out.write(buf, 0, n);
          }
          out.flush();
        }
        if (!apk.isFile() || apk.length() < 64) {
          throw new IllegalStateException("Downloaded APK is empty");
        }

        Uri uri =
          FileProvider.getUriForFile(
            ctx,
            ctx.getPackageName() + ".apkprovider",
            apk
          );
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(uri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = getCurrentActivity();
        MAIN.post(() -> {
          try {
            if (activity != null) {
              activity.startActivity(install);
            } else {
              ctx.startActivity(install);
            }
            promise.resolve(true);
          } catch (Exception e) {
            promise.reject("INSTALL", e);
          }
        });
      } catch (Exception e) {
        promise.reject("DOWNLOAD", e);
      } finally {
        if (conn != null) conn.disconnect();
      }
    });
  }

  private static HttpURLConnection open(URL url, int hops) throws Exception {
    if (hops > 5) {
      throw new IllegalStateException("Too many redirects");
    }
    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
    conn.setInstanceFollowRedirects(false);
    conn.setConnectTimeout(20_000);
    conn.setReadTimeout(60_000);
    conn.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
    conn.connect();
    int code = conn.getResponseCode();
    if (code == HttpURLConnection.HTTP_MOVED_PERM
        || code == HttpURLConnection.HTTP_MOVED_TEMP
        || code == HttpURLConnection.HTTP_SEE_OTHER
        || code == 307
        || code == 308) {
      String location = conn.getHeaderField("Location");
      conn.disconnect();
      if (location == null || !location.startsWith("https://")) {
        throw new IllegalStateException("Redirect must stay on HTTPS");
      }
      return open(new URL(location), hops + 1);
    }
    return conn;
  }

  private static HttpURLConnection open(URL url) throws Exception {
    return open(url, 0);
  }
}
