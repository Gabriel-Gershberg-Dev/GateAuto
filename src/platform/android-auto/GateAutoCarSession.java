package com.gateauto.app.car;

import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.car.app.Screen;
import androidx.car.app.Session;

public class GateAutoCarSession extends Session {
  @NonNull
  @Override
  public Screen onCreateScreen(@NonNull Intent intent) {
    return new GateAutoCarScreen(getCarContext());
  }
}
