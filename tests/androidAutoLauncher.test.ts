import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('phone APK must not launch CarAppActivity', () => {
  it('plugin strips CarAppActivity instead of making it a launcher', () => {
    const plugin = fs.readFileSync(
      path.join(process.cwd(), 'src', 'platform', 'withAndroidAuto.js'),
      'utf8',
    );
    assert.ok(plugin.includes("'tools:node': 'remove'"));
    assert.ok(plugin.includes('androidx.car.app.activity.CarAppActivity'));
    assert.ok(
      !plugin.includes(
        "category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }]",
      ),
    );
  });

  it('built manifest does not expose CarAppActivity as MAIN/LAUNCHER', () => {
    const manifestPath = path.join(
      process.cwd(),
      'android',
      'app',
      'src',
      'main',
      'AndroidManifest.xml',
    );
    if (!fs.existsSync(manifestPath)) return;
    const xml = fs.readFileSync(manifestPath, 'utf8');
    const carLine = xml
      .split(/\r?\n/)
      .find((line) => line.includes('androidx.car.app.activity.CarAppActivity'));
    assert.ok(carLine, 'CarAppActivity should be explicitly removed');
    assert.ok(carLine.includes('tools:node="remove"'));
    assert.ok(!carLine.includes('android.intent.category.LAUNCHER'));
    assert.ok(xml.includes('android:name=".MainActivity"'));
  });

  it('searching notice still pins MainActivity', () => {
    const java = fs.readFileSync(
      path.join(
        process.cwd(),
        'src',
        'platform',
        'android-keepalive',
        'MonitoringNotice.java',
      ),
      'utf8',
    );
    assert.ok(java.includes('com.gateauto.app.MainActivity'));
    assert.ok(!java.includes('getLaunchIntentForPackage('));
  });
});
