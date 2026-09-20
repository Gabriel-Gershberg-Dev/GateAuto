# Changelog

GateAuto version history. **1.0.0–1.0.6** are real git commits. **1.0.7–1.0.45** were shipped as APKs and Remote Config updates but were never committed one-by-one; those notes were reconstructed from publish logs (Cursor sessions + Firebase). The source tree at `v1.0.48` is the current app.

Channels:

- **Production** — family `Check for update`. Live: **1.0.48** (versionCode 49).
- **Beta** — Settings → tap version 7× → password. Live: **1.0.51** (versionCode 52).

Git tags match source, not every sideload: `v1.0.6`, `v1.0.46`, and `v1.0.48`.

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
