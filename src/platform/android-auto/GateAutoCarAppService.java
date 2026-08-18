package com.gateauto.app.car;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;

/**
 * Android Auto entry. Manifest declares IOT (Play garage/gate) and POI
 * (sideload listing — many projected hosts hide IOT). ALLOW_ALL for sideload.
 */
public class GateAutoCarAppService extends CarAppService {
  private static final String TAG = "GateAutoCar";

  @NonNull
  @Override
  public HostValidator createHostValidator() {
    // Sideloaded APKs + DHU. Play Store would use hosts_allowlist_sample only.
    return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
  }

  @NonNull
  @Override
  public Session onCreateSession() {
    Log.i(TAG, "onCreateSession — Android Auto bound GateAuto");
    return new GateAutoCarSession();
  }
}
