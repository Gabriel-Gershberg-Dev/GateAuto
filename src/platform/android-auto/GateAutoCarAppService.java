package com.gateauto.app.car;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;

/**
 * Android Auto entry. Category IOT (Car API 6+) — garage/gate control.
 * Host-styled templates only; not a React Native screen.
 */
public class GateAutoCarAppService extends CarAppService {
  @NonNull
  @Override
  public HostValidator createHostValidator() {
    // Sideloaded APKs + DHU. Play Store would use hosts_allowlist_sample only.
    return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
  }

  @NonNull
  @Override
  public Session onCreateSession() {
    return new GateAutoCarSession();
  }
}
