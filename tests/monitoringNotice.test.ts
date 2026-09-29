import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  HOLD_NOTIF_ID,
  MONITORING_NOTIF_ID,
  activeNoticeId,
  monitoringNoticeText,
  newNoticeRestoreState,
  shouldAllowNoticeRestore,
  shouldRepostDismissedNotice,
} from '../src/platform/monitoringNoticeText';

const NOW = 1_700_000_000_000;

describe('monitoringNoticeText', () => {
  it('names the armed gate count with singular / plural', () => {
    assert.equal(
      monitoringNoticeText(5, NOW - 12_000, NOW),
      'Monitoring 5 gates · last check 12s ago',
    );
    assert.equal(
      monitoringNoticeText(1, NOW - 30_000, NOW),
      'Monitoring 1 gate · last check 30s ago',
    );
    assert.equal(
      monitoringNoticeText(2, NOW - 30_000, NOW),
      'Monitoring 2 gates · last check 30s ago',
    );
  });

  it('falls back to searching when no gate is armed', () => {
    assert.equal(
      monitoringNoticeText(0, NOW - 20_000, NOW),
      'Searching for nearby gates · last check 20s ago',
    );
    assert.equal(
      monitoringNoticeText(-1, NOW - 20_000, NOW),
      'Searching for nearby gates · last check 20s ago',
    );
  });

  it('says starting before the first check has run', () => {
    assert.equal(monitoringNoticeText(3, 0, NOW), 'Monitoring 3 gates · starting…');
    assert.equal(monitoringNoticeText(0, 0, NOW), 'Searching for nearby gates · starting…');
  });

  it('buckets freshness from just now up to hours', () => {
    assert.equal(monitoringNoticeText(1, NOW, NOW), 'Monitoring 1 gate · last check just now');
    assert.equal(
      monitoringNoticeText(1, NOW - 9_999, NOW),
      'Monitoring 1 gate · last check just now',
    );
    assert.equal(
      monitoringNoticeText(1, NOW - 10_000, NOW),
      'Monitoring 1 gate · last check 10s ago',
    );
    assert.equal(
      monitoringNoticeText(1, NOW - 59_999, NOW),
      'Monitoring 1 gate · last check 59s ago',
    );
    assert.equal(
      monitoringNoticeText(1, NOW - 60_000, NOW),
      'Monitoring 1 gate · last check 1m ago',
    );
    assert.equal(
      monitoringNoticeText(1, NOW - 25 * 60_000, NOW),
      'Monitoring 1 gate · last check 25m ago',
    );
    assert.equal(
      monitoringNoticeText(1, NOW - 3 * 3_600_000, NOW),
      'Monitoring 1 gate · last check 3h ago',
    );
  });

  it('never renders a negative age when the clock moves backwards', () => {
    assert.equal(
      monitoringNoticeText(2, NOW + 60_000, NOW),
      'Monitoring 2 gates · last check just now',
    );
  });
});

describe('monitoring notice re-post guard', () => {
  it('only restores the notice of the service that is actually running', () => {
    const monitoring = {
      armed: true,
      monitoringServiceRunning: true,
      holdServiceRunning: false,
    };
    assert.equal(activeNoticeId(monitoring), MONITORING_NOTIF_ID);
    assert.equal(shouldRepostDismissedNotice(monitoring, MONITORING_NOTIF_ID), true);
    // Stale id from the other service must not be resurrected.
    assert.equal(shouldRepostDismissedNotice(monitoring, HOLD_NOTIF_ID), false);

    const hold = {
      armed: true,
      monitoringServiceRunning: false,
      holdServiceRunning: true,
    };
    assert.equal(activeNoticeId(hold), HOLD_NOTIF_ID);
    assert.equal(shouldRepostDismissedNotice(hold, HOLD_NOTIF_ID), true);
    assert.equal(shouldRepostDismissedNotice(hold, MONITORING_NOTIF_ID), false);
  });

  it('never restores after Auto-open is turned off', () => {
    const disarmed = {
      armed: false,
      monitoringServiceRunning: true,
      holdServiceRunning: true,
    };
    assert.equal(activeNoticeId(disarmed), 0);
    assert.equal(shouldRepostDismissedNotice(disarmed, MONITORING_NOTIF_ID), false);
    assert.equal(shouldRepostDismissedNotice(disarmed, HOLD_NOTIF_ID), false);
  });

  it('never restores when no monitoring service is running (force-stop / Stop in Active apps)', () => {
    const dead = {
      armed: true,
      monitoringServiceRunning: false,
      holdServiceRunning: false,
    };
    assert.equal(activeNoticeId(dead), 0);
    assert.equal(shouldRepostDismissedNotice(dead, MONITORING_NOTIF_ID), false);
    assert.equal(shouldRepostDismissedNotice(dead, 0), false);
  });

  it('never restores when the user hid the searching notice', () => {
    const hidden = {
      armed: true,
      monitoringServiceRunning: true,
      holdServiceRunning: false,
      monitorNoticeEnabled: false,
    };
    assert.equal(shouldRepostDismissedNotice(hidden, MONITORING_NOTIF_ID), false);
    assert.equal(
      shouldRepostDismissedNotice(
        { ...hidden, monitorNoticeEnabled: true },
        MONITORING_NOTIF_ID,
      ),
      true,
    );
  });

  it('never restores when all notifications are off', () => {
    const muted = {
      armed: true,
      monitoringServiceRunning: true,
      holdServiceRunning: false,
      noticesEnabled: false,
    };
    assert.equal(shouldRepostDismissedNotice(muted, MONITORING_NOTIF_ID), false);
  });

  it('allows normal dismiss/restore cycles', () => {
    const state = newNoticeRestoreState();
    assert.equal(shouldAllowNoticeRestore(state, NOW), true);
    assert.equal(shouldAllowNoticeRestore(state, NOW + 30_000), true);
    assert.equal(shouldAllowNoticeRestore(state, NOW + 120_000), true);
  });

  it('backs off instead of storming when something cancels us repeatedly', () => {
    const state = newNoticeRestoreState();
    for (let i = 0; i < 5; i += 1) {
      assert.equal(shouldAllowNoticeRestore(state, NOW + i * 100), true);
    }
    assert.equal(shouldAllowNoticeRestore(state, NOW + 600), false);
    // Still backed off a few seconds later…
    assert.equal(shouldAllowNoticeRestore(state, NOW + 30_000), false);
    // …and recovers once the backoff has passed.
    assert.equal(shouldAllowNoticeRestore(state, NOW + 61_000), true);
  });
});

describe('MonitoringNotice.java stays in sync with the spec', () => {
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

  it('uses the same status wording and separator', () => {
    for (const literal of [
      '"Searching for nearby gates"',
      '"Monitoring 1 gate"',
      '"Monitoring " + gateCount + " gates"',
      '" · "',
      '"starting…"',
      '"last check just now"',
      '"last check " + (age / 1000L) + "s ago"',
      '"last check " + (age / MINUTE_MS) + "m ago"',
      '"last check " + (age / HOUR_MS) + "h ago"',
    ]) {
      assert.ok(java.includes(literal), `MonitoringNotice.java is missing ${literal}`);
    }
  });

  it('keeps the notice silent and self-restoring', () => {
    for (const call of [
      '.setOnlyAlertOnce(true)',
      '.setSilent(true)',
      '.setOngoing(true)',
      '.setDeleteIntent(',
      'FLAG_NO_CLEAR',
    ]) {
      assert.ok(java.includes(call), `MonitoringNotice.java is missing ${call}`);
    }
    // A bare header chronometer was rejected — see the class javadoc.
    assert.ok(!java.includes('setUsesChronometer(true)'));
  });

  it('guards the re-post on armed + a running owner service with the same backoff', () => {
    assert.ok(java.includes('if (!KeepAlivePrefs.isArmed(app)) {'));
    assert.ok(java.includes('if (!KeepAlivePrefs.monitorNoticeVisible(app)) {'));
    assert.ok(java.includes('if (dismissedId != activeNotifId(app)) {'));
    assert.ok(java.includes('MonitoringService.isRunning()'));
    assert.ok(java.includes('HoldService.isRunning()'));
    assert.ok(java.includes('RESTORE_WINDOW_MS = 10_000L'));
    assert.ok(java.includes('RESTORE_LIMIT = 5'));
    assert.ok(java.includes('RESTORE_BACKOFF_MS = 60_000L'));
    assert.ok(java.includes('applyUserPreference'));
    assert.ok(java.includes('startForegroundHonoringPreference'));
  });

  it('keeps the service foreground when the user hides the notice', () => {
    // A demoted hold is what Samsung / battery saver stop between arrivals.
    assert.ok(!java.includes('stopForeground('));
    assert.ok(java.includes('if (!KeepAlivePrefs.monitorNoticeVisible(app)) return buildQuiet(app);'));
    assert.ok(java.includes('NotificationManager.IMPORTANCE_MIN'));
    const quiet = java.slice(java.indexOf('private static Notification buildQuiet'));
    const quietBody = quiet.slice(0, quiet.indexOf('private static void ensureQuietChannel'));
    assert.ok(!quietBody.includes('setDeleteIntent('), 'a swiped quiet notice must stay gone');
  });

  it('matches the notification ids the services own', () => {
    const monitoring = fs.readFileSync(
      path.join(
        process.cwd(),
        'src',
        'platform',
        'android-keepalive',
        'MonitoringService.java',
      ),
      'utf8',
    );
    const hold = fs.readFileSync(
      path.join(
        process.cwd(),
        'src',
        'platform',
        'android-keepalive',
        'HoldService.java',
      ),
      'utf8',
    );
    assert.ok(monitoring.includes(`NOTIF_ID = ${MONITORING_NOTIF_ID}`));
    assert.ok(hold.includes(`NOTIF_ID = ${HOLD_NOTIF_ID}`));
    assert.ok(monitoring.includes('startForegroundHonoringPreference'));
    assert.ok(hold.includes('startForegroundHonoringPreference'));
    assert.ok(!monitoring.includes('stopForeground('));
    assert.ok(!hold.includes('stopForeground('));
  });

  it('never stops a HoldService start before it reaches startForeground', () => {
    const read = (name: string) =>
      fs.readFileSync(
        path.join(process.cwd(), 'src', 'platform', 'android-keepalive', name),
        'utf8',
      );
    const hold = read('HoldService.java');
    const monitoring = read('MonitoringService.java');
    const stopBody = hold.slice(hold.indexOf('public static void stop(Context context)'));
    assert.ok(
      stopBody.slice(0, stopBody.indexOf('stopService')).includes('if (instance == null) return;'),
      'stop() must skip a start that has not promoted yet',
    );
    const onCreate = hold.slice(hold.indexOf('public void onCreate()'));
    assert.ok(
      onCreate.indexOf('promote();') < onCreate.indexOf('instance = this;'),
      'instance is published only after startForeground',
    );
    assert.ok(hold.includes('if (MonitoringService.isForeground()) {'));
    assert.ok(hold.includes('if (MonitoringService.isForeground()) return;'));
    assert.ok(monitoring.includes('if (foreground) HoldService.stop(this);'));
    assert.ok(!monitoring.includes('    HoldService.stop(this);\n    ensureChannel();'));
  });

  it('never stops a MonitoringService start before it reaches startForeground', () => {
    const monitoring = fs.readFileSync(
      path.join(process.cwd(), 'src', 'platform', 'android-keepalive', 'MonitoringService.java'),
      'utf8',
    );
    const stopBody = monitoring.slice(
      monitoring.indexOf('public static void stop(Context context)'),
    );
    assert.ok(
      stopBody.slice(0, stopBody.indexOf('stopService')).includes('if (instance == null) return;'),
      'stop() must skip a start that has not promoted yet',
    );
    const onCreate = monitoring.slice(
      monitoring.indexOf('public void onCreate()'),
      monitoring.indexOf('public int onStartCommand'),
    );
    const promoteAt = onCreate.indexOf('promote();');
    assert.ok(promoteAt >= 0, 'onCreate promotes without the armed check');
    assert.ok(!onCreate.includes('promoteOrHideNotice();'));
    assert.ok(promoteAt < onCreate.indexOf('instance = this;'));
  });

  it('does not start the shortService boot sync from BOOT_COMPLETED on Android 15+', () => {
    const plugin = fs.readFileSync(
      path.join(process.cwd(), 'src', 'platform', 'withAndroidBootSync.js'),
      'utf8',
    );
    const receiver = plugin.slice(0, plugin.indexOf('const SERVICE_JAVA'));
    const skipAt = receiver.indexOf('Build.VERSION.SDK_INT >= 35');
    assert.ok(skipAt >= 0);
    assert.ok(skipAt > receiver.indexOf('KeepAliveScheduler.start(context);'));
    assert.ok(skipAt < receiver.indexOf('startForegroundService(service)'));
    assert.ok(receiver.includes('!Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)'));
  });
});
