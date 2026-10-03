# Changelog

GateAuto version history. **1.0.0–1.0.6** are real git commits. **1.0.7–1.0.45** were shipped as APKs and Remote Config updates but were never committed one-by-one; those notes were reconstructed from publish logs (Cursor sessions + Firebase). The source tree at `v1.0.48` is the current app.

Channels:

- **Production** — family `Check for update`. Live: **1.0.67** (versionCode 68).
- **Beta** — Settings → tap version 7× → password. Live: **1.0.78** (versionCode 79).

Git tags match source, not every sideload: `v1.0.6`, `v1.0.46`, `v1.0.48`, `v1.0.60`, `v1.0.61`, `v1.0.62`, `v1.0.63`, `v1.0.64`, `v1.0.65`, `v1.0.66`, `v1.0.67`, `v1.0.68`, `v1.0.69`, `v1.0.70`, `v1.0.71`, `v1.0.72`, `v1.0.73`, `v1.0.74`, `v1.0.75`, `v1.0.76`, `v1.0.77`, and `v1.0.78`.

## 1.0.78 — 2026-10-04 (beta)

Sign-up no longer jumps off the top of the screen when the keyboard opens. The password stays in view.

## 1.0.77 — 2026-10-04 (beta)

The sign-in password stays visible above the keyboard. A code sent to an email opens only for that email. Each invite code has a copy button.

## 1.0.76 — 2026-10-04 (beta)

Walking and Motion stay in developer options. Auto-open keeps the switch you left for that account after sign-out. Invites show who a code was for and who redeemed it. A redeemed code cannot be used again. Allow sharing is the share switch. A shared-again gate tells the other person it will turn back on. Tapping outside an invite leaves it pending. Accept opens the gate list, and back returns to Link PalGate. The sign-in password stays above the keyboard.

## 1.0.75 — 2026-10-04 (beta)

A fence enter while Walking is on uses the close walking distance. 16 m no longer opens a 7 m walk.

## 1.0.74 — 2026-10-04 (beta)

Walking keeps the GPS stream on. Far away it checks every 30 seconds. Inside about 100 m it checks every second. The open stays at the close walking distance.

## 1.0.73 — 2026-10-04 (beta)

Background Auto-open stays up. The Xiaomi car check no longer takes its place, and a locked phone still checks the gates.

## 1.0.72 — 2026-10-03 (beta)

On Xiaomi, Redmi, and POCO, Auto-open keeps checking for the car while it waits. The location icon stays off until the car is connected.

## 1.0.71 — 2026-10-03 (beta)

The opening screen no longer waits forever. If sign-in or the gates on the phone do not finish, a signed-in open continues into the app.

## 1.0.70 — 2026-10-03 (beta)

Revoking an invite turns those gates off for the other person. Invites has a Revoke button on each code.

## 1.0.69 — 2026-10-02 (beta)

When you share a gate you scanned, they can share it onward unless you turn that off. A gate that is not allowed to be shared says so, and a mixed selection can send only the ones that are allowed. Invites sits next to Share gates and shows the gates in each code you sent.

## 1.0.68 — 2026-10-02 (beta)

Walking opens on foot, next to the gate, without the car. In the car, Auto-open stays as you set it. Normal is about 7 m, High a few steps earlier. Motion is off until you turn it on: then being on foot opens close even if the car is still connected, and driving keeps the car path.

## 1.0.67 — 2026-10-02 — **production (family)**

The widget hint under Auto-open is gone. Developer options use a flask icon. The warning before turning notifications off, and the searching-notice line, are shorter. A PalGate no longer shows the end of a phone number under its name.

## 1.0.66 — 2026-10-01 (beta)

A newly scanned PalGate is named after the signed-in user, and that name can be edited. PalGates already on the phone keep their names. Settings uses a key for permissions and a tag for the version. My location is translated. Hold’s description is shorter. The armed / not fully armed line is gone. Turning off all notifications asks first, and says you will not be told when a gate opens on Auto-open. Android still keeps one silent line while Auto-open is working, because the phone needs it.

## 1.0.65 — 2026-10-01 (beta)

Location stays off while every auto-open gate waits for a listed car. Play kept GPS-checking a leftover Expo geofence copy every ~10 minutes all night after the car disconnected, because only the app screen removed it; on Android the native fences are now the only ones, and they drop with demand. A TV, PC or earbuds connecting over Bluetooth no longer reads location, a fence wake or MonitoringService restart without demand no longer turns GPS on, and a car disconnect that lands mid-sync is applied instead of dropped. With nothing needing location there is no background hold, so no "Auto-open is running" notice; when there is one, it is posted once and stays gone after a swipe. Brief boot and gate-check notices are deferred so a quick run never reaches the shade. Address search uses Google Places autocomplete, so the list grows with every letter like Google Maps, with the geocoder as fallback. The Hebrew search box, its hint and the gate name field sit on the right, and pin coordinates read "lat, lng" instead of flipping to "lng ,lat".

## 1.0.64 — 2026-09-30 (beta)

Address search lists every matching place as you type. The same street in two cities stays as two rows, and the pin moves only after you tap one.

## 1.0.63 — 2026-09-30 (beta)

Hebrew layout reads right to left. Wrapped lines start on the right, settings chevrons point left, and "on" is on the left of every toggle (including Xiaomi, which does not mirror Android's switch). Number ranges and the version read left to right.

## 1.0.62 — 2026-09-29 (beta)

Reopening after swiping the app away no longer sticks on the startup animation. The hold keeps the process alive, so Android recreates the screen in the same JS runtime; 1.0.61 remembered the signed-in user at module level and ignored the new screen's first auth callback.

## 1.0.61 — 2026-09-29 (beta)

Auto-open stays foreground in the background even with the searching notice or all notifications off: the notice shrinks to a silent one instead of `stopForeground(REMOVE)` demoting the service, which Samsung then killed. A HoldService or MonitoringService start is never stopped before it reaches `startForeground`; that race crashed the app twice in a minute, and Android then blocked background wakes until the app was opened (seen on S21 FE and S22 Ultra on 1.0.30/1.0.48). Android 15+ reboots no longer crash on the shortService boot sync. Startup no longer hangs on a stuck connection: it resets Firestore's network, asks Android to revalidate at most once a minute, and after two misses offers Refresh connection / Open anyway. Telemetry adds notice, notification, battery, exact-alarm and hold state.

## 1.0.60 — 2026-09-29 (beta)

Wide strip is back to the previous list. Swipe up for more gates.

## 1.0.59 — 2026-09-29 (beta)

Wide widget strip is a real scrolling list: swipe up to the next gates. Left/right still moves the home screen.

## 1.0.58 — 2026-09-29 (beta)

Widget taps register on name/range/background (not only the cube root). Opening paints immediately, queues presses instead of dropping them, and uses the platform spinner without full-list rebinds that restart the animation.

## 1.0.57 — 2026-09-29 (beta)

Larger widget sizes paint gates instead of sitting on Loading. Wide strip uses the same list machinery as the tall widget (home screens leave GridView spinning).

## 1.0.56 — 2026-09-29 (beta)

Tap a widget gate to open it — the cube lights and spins instead of an Open pill. The wide strip scrolls like the tall list (home screens steal horizontal swipes).

## 1.0.55 — 2026-09-29 (beta)

Wide strip shows two fuller cubes when the widget is narrow (three when it is wide), swipe between pages, and ‹ › on the sides if the home screen steals the swipe.

## 1.0.54 — 2026-09-29 (beta)

Wide widget pages extra gates; tall widget stacks the same cubes instead of squishing rows. The APK versionCode now follows app.json so Check for beta updates does not re-offer a version you already have.

## 1.0.53 — 2026-09-20 (beta)

Auto-open no longer starts the leftover Expo GPS stream or Play fences when every auto-on gate is Bluetooth-required (or manual). The status-bar location indicator should stay off until a listed car connects.

## 1.0.52 — 2026-09-20 (beta)

When every auto-open gate requires a listed car (manual gates ignored), GPS and Play fences stay off until that car connects. A proximity-only auto gate still keeps location on as before.

## 1.0.51 — 2026-09-20 (beta)

Widget face ranks from a cached location (MonitoringService ticks / tap) instead of blocking on Play Services last-location. Screen-on and region-save paints are cache-only; tap still takes a current fix.

## 1.0.50 — 2026-09-20 (beta)

Widget face is mist glass (no teal box). Every gate cell has its own Open. Larger list rows.

## 1.0.49 — 2026-09-20 (beta)

Home-screen widget: closest pinned gate, three resize layouts. Tap opens that gate even if Auto-open is off.

## 1.0.48 — 2026-09-20 — **production (family)**

Take a gate out of a list without deleting it (**From list**). **Remove** still deletes the gate. Also includes named lists, add-to-existing-list, notification settings, and locked-phone / Android Auto work shipped on beta after 1.0.30.

## 1.0.47 — 2026-09-20 (beta)

Add a gate to an existing list: long-press → List → pick a list, or expand a list and tap Add.

## 1.0.46 — 2026-09-20 (beta)

List cards have no header Open (a list is a folder). Nested gates sit in a clipped rounded well. Selection bar stays one row: count, List / Share / Remove, close mark.

## 1.0.45 — 2026-09-20 (beta)

Named gate lists: long-press 2+ gates → List → expandable card with rename / ungroup.

## 1.0.44 — 2026-09-20 (beta)

Notification settings: master off, plus Gate opened / Searching / App updates.

## 1.0.43 — 2026-09-19 (beta)

Phone has one launcher. Update notices open GateAuto, not Android Auto’s black “Check for updates” screen.

## 1.0.42 — 2026-09-19 (beta)

Turning off the searching notice actually removes it (`stopForeground(REMOVE)`). Auto-open keeps running.

## 1.0.41 — 2026-09 (beta, device)

Android Auto header icons drawn as real grid/list pixels. Searching notice opens the phone app.

## 1.0.39–1.0.40 — 2026-09 (beta, device)

Dropped Grid | List | Auto tabs. Header is On/Off plus a layout icon again.

## 1.0.37 — 2026-09 (beta, device)

Android Auto Grid / List / Auto tabs (later reverted).

## 1.0.36 — 2026-09 (beta, device)

Car header crash: only one titled action allowed. Layout switch became an icon.

## 1.0.35 — 2026-09 (beta, device)

Android Auto list/grid remembered. Opened tile shows a raised boom-arm.

## 1.0.33 — 2026-09 (beta, device)

Android Auto open as a short animated beat (Opening → Opened), not a tiny-icon grid.

## 1.0.32 — 2026-09 (beta, device)

Tapping Open in the car no longer flashes “could not load.”

## 1.0.31 — 2026-09 (beta, device)

Sideloaded Android Auto could not bind (`BIND_CAR_APP`). Restriction removed so DHU connects.

## 1.0.30 — 2026-09 — production (later superseded)

Settings → Notifications: hide searching notice; tray ping when an update is ready. Locked-phone auto-open left as in 1.0.27–1.0.29. Family used this until 1.0.48.

## 1.0.29 — 2026-09 (beta)

Approach sampler: ~1 GPS fix per second while approaching (including locked). Far away stays ~30s.

## 1.0.28 — 2026-09 (beta)

Detect fence at least 100 m, then a fresh GPS sample can open every nearby pin (not only the fence that fired).

## 1.0.27 — 2026-08 — production (later superseded)

Locked-phone open: Bluetooth read off the critical path (no main-looper deadlock with HoldService). Promoted to family, then followed by 1.0.28–1.0.30.

## 1.0.26 — 2026-08 (beta)

Live monitoring notice: gate count and last-check freshness.

## 1.0.25 — 2026-08 — production (later superseded)

Car Bluetooth: address **or** name; unknown BT permission falls open on proximity instead of blocking. Promoted to family.

## 1.0.24 — 2026-08 (beta)

Hebrew RTL: full React reload so JS direction matches native. Persistence work toward always-on checks.

## 1.0.23 — 2026-08 (beta)

HoldService: non-location FGS so a background-woken process stays warm (`adj=200`) instead of being killed as cached.

## 1.0.22 — 2026-08 (beta)

Cold open: wakelock across PalGate, shorter timeouts + one retry, `latency_ms` / warm vs cold telemetry.

## 1.0.21 — 2026-08 (beta)

Analytics + Crashlytics. Secrets, pins, and exact GPS not included.

## 1.0.20 — 2026-08 — production (later superseded)

Selection keys at 38px. Promoted to family.

## 1.0.19 — 2026-08 (beta)

Unboxed Share / Remove / Cancel. Long-press on the first row no longer starts pull-to-refresh.

## 1.0.18 — 2026-08 (beta)

Long-press goes straight into multi-select (no sheet). Cabin-HUD selection rail.

## 1.0.17 — 2026-08 (beta)

Compact Got it / Cancel. Multi-select restored. Hint is a small HUD readout.

## 1.0.16 — 2026-08 (beta)

Share only on long-press. Compact row + info hint for details that used to clip.

## 1.0.15 — 2026-08 (beta)

Backup poll no longer starts a second “Checking gate…” job or waits on High GPS (fixes the 22:51–23:15 stuck check).

## 1.0.14 — 2026-08 (beta)

Version bump so Check for beta updates has something newer than family 1.0.13.

## 1.0.13 — 2026-08 — production (later superseded)

Hidden beta unlock (7 taps + password) and a separate beta Remote Config channel. Then promoted to family.

## 1.0.12 — 2026-08

Open only inside the radius you set (Play ENTER was allowed out to 250 m). Bluetooth / Unrestricted status from 1.0.11 included.

## 1.0.11 — 2026-08

Permissions screen follows real OS state (Bluetooth, Samsung Unrestricted).

## 1.0.10 — 2026-08

Hide expected `expoLocation.hasStarted…` rejection from the Gates banner.

## 1.0.9 — 2026-08

After login: Always location, notifications, Bluetooth, battery Unrestricted. Skip allowed; Gates shows a warning until granted.

## 1.0.8 — 2026-08

Open at the configured radius without waiting 20–30 s on stale Balanced GPS.

## 1.0.7 — 2026-08

False share-revoke cleanup; language OK reloads layout; sign-out returns to Sign in.

## 1.0.6 — 2026-08-20 — **git `v1.0.6`**

Owner unlink disables shared copies. Settings language stays put. BT-off inside can open via native poll.

Earlier commits on this branch cover Firebase Auth, gate sharing, multi PalGate systems, keep-alive, and the first Android Auto listing.
