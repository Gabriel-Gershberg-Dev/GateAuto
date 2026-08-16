# GateAuto

GateAuto is an Expo (Development Client) React Native app that auto-opens PalGate gates when you arrive. It links as a PalGate **Linked Device**, then on geofence enter it refines your location, optionally checks car Bluetooth, and opens the gate via the PalGate API—useful when native PalGate AutoOpen is missing or imprecise.

Primary target: **Galaxy S25 Ultra**. Same codebase builds for **iOS**.

## Project location

This project lives at **`C:\dev\GateAuto`**. Do not develop from a SynologyDrive (or other synced) copy—file ops there have caused `EPERM` rename failures during Expo prebuild/scaffold. Keep Cursor’s workspace pointed here.

## Prerequisites

- **Node.js** 20+ (24 is fine)
- **Android Studio** with Android SDK platform tools
- Physical Android phone with **USB debugging** enabled (Developer options)
- For store-style installs: Expo account + [EAS CLI](https://docs.expo.dev/build/setup/) (`npm i -g eas-cli`)

## Why not Expo Go?

GateAuto needs a **custom Development Client** (or EAS preview build), not Expo Go. Native Bluetooth classic (`react-native-bluetooth-classic`) and reliable Always-location / background geofencing require native modules and config that Expo Go does not provide.

## Install & run (Android)

```bash
cd C:\dev\GateAuto
npm install
npx expo install
npx expo prebuild --platform android
npx expo run:android
```

`npx expo run:android` builds the Dev Client and installs it on a USB-connected device (or emulator).

### EAS preview (installable APK/AAB)

```bash
eas build -p android --profile preview
```

Install the artifact on the phone, then continue with phone setup below.

## Galaxy S25 Ultra setup

After install, before relying on auto-open:

1. **Location** — Allow → then set to **Always** (Settings → Apps → GateAuto → Permissions → Location → Always). Background geofencing will not work with “While using” only.
2. **Notifications** — Allow. While monitoring is on, Android shows a quiet **GateAuto auto-open** service notification (min importance, no heads-up). You also get open/fail alerts.
3. **Bluetooth** — Allow (Android 12+); needed when a gate requires car BT match.
4. **Battery** — Settings → Apps → GateAuto → Battery → **Unrestricted**. Disable any “put app to sleep” / deep sleeping for GateAuto (One UI).

Also complete the in-app Permissions checklist if prompted.

### How auto-open triggers

While **Monitoring** is ON:

| Trigger | When it fires |
|---------|----------------|
| **Geofence ENTER** | True boundary cross into the gate radius → brief refine → if BT required, retry every ~3s for ~27s → open |
| **Bluetooth connect** | Car head unit (ACL / A2DP / headset) connects and matches a gate’s device list **while you are already inside** radius×1.15 → open (primary for home fences that always cover the house) |

Re-registering geofences / opening the app while already inside does **not** spam opens (`skipped_bt` bursts): ENTER is ignored for ~60s after sync.

### What survives kill / swipe

| Situation | Auto-open |
|-----------|-----------|
| App in background or swiped away | Yes — quiet FGS + OS geofences + BT connect listener (Unrestricted battery) |
| Phone reboot | Yes after brief boot re-registration if monitoring was left ON |
| **Force stop** (App info → Force stop) | **No** until you open GateAuto again — Android blocks *all* components (FGS, geofences, BT receivers, boot, alarms). No normal app can restart itself after Force stop. Opening the app again restores monitoring if the flag was ON. |
| Heavy OEM battery kill / Deep sleeping | May stop until next open — keep Unrestricted |

Battery approach: OS geofences + BT-connect callbacks; silent low-importance FGS only while monitoring is ON (not continuous high-accuracy GPS). One brief refine on ENTER (capped retries).

## Linked Device QR flow

1. Open GateAuto (no credentials yet) → **Link** screen shows a QR encoding `{"id":"<uuid>"}`.
2. On another phone (or the same phone if you can switch apps): open the official **PalGate** app → menu → **Linked Devices** → **Link a Device** → scan the QR.
3. GateAuto polls until link succeeds, then stores session credentials securely.
4. Continue to Permissions, then the gates list.

**Same-phone linking is fragile:** switching from GateAuto to PalGate to scan often kills the long-poll. Prefer **PiP / split screen**, or link on an **emulator** (QR stays foreground) and use **Export → Import** below. During wait, GateAuto keeps the screen awake and shows a sticky “Keep GateAuto open — linking…” notification.

### Transfer credentials (emulator → phone)

After a successful link (or from Gates → **Export** / Link when already linked):

1. Tap **Export account** — shows a QR + copyable JSON `{ phoneNumber, sessionToken, tokenType }` (not written to the event log).
2. On the target phone’s GateAuto **Link** screen → **Import account** — paste (or scan the export QR with any QR reader and paste the JSON).
3. Import runs check-token and continues to Permissions / Gates.

Personal transfer only — anyone with that JSON can use the Linked Device session.

To unlink later: use Unlink in the app (clears SecureStore credentials and stops geofences).

## Google Maps (optional)

The interactive map in Gate Editor needs a Google Maps API key. **Pin placement works without maps** via **Use current location** (GPS) or manual lat/lng fields.

To enable the map preview:

1. Create a Maps SDK for Android key in Google Cloud Console.
2. Set env var `GOOGLE_MAPS_API_KEY` before `expo prebuild` / `expo run:android`, or put the key in `app.json` → `expo.android.config.googleMaps.apiKey` (see `app.config.js`).
3. Rebuild the native app so `AndroidManifest` picks up `com.google.android.geo.API_KEY`.

Without a key, GateAuto must not mount `MapView` (an empty key still crashes native maps). Linking, permissions, and GPS pin setup work without maps.

## Configure gates

1. Pull devices from PalGate on the **Gates** list.
2. Open a gate → **Gate Editor**:
   - Set map **pin** (drag on the map if a Maps key is configured, or use current location / lat-lng fields)
   - Set **radius** (default ~50 m; typical range 25–150 m)
   - Optional: require **car Bluetooth** — connect the phone to the car first, then pick the connected device
   - Set **cooldown** (default ~5 min) so one arrival doesn’t spam opens
   - Tap **Test Open** to verify the API open works
   - Enable **auto-open** only after Test Open succeeds (auto-open defaults off)
3. Turn **monitoring** on so geofences register for enabled gates.

## Road-test checklist

Drive/walk tests after config:

- [ ] Arrive within configured **radius** with monitoring on → gate opens (or expected skip logged)
- [ ] Outside radius / bad refine accuracy → no open (`skipped_refine` or similar in Monitoring log)
- [ ] Gate with car BT required: **BT connected** → opens; **BT off / wrong device** → `skipped_bt`, no open
- [ ] Already inside home fence: connect car BT → `bt_connect_open` (or `bt_connect_outside` if not in zone)
- [ ] Immediate re-entry within **cooldown** → skipped (`cooldown`), no second open
- [ ] Notifications fire on open / error; quiet “GateAuto auto-open” while monitoring is on
- [ ] After reboot or battery restriction change, re-check Always location + Unrestricted battery
- [ ] After **Force stop**, open GateAuto once — monitoring restores if it was left ON

Tune radius and cooldown from the Monitoring event log.

## iOS (brief)

Same TypeScript codebase. You need an Apple Developer account, then:

```bash
npx expo run:ios
# or
eas build -p ios --profile preview
```

Grant **Always** location and background location usage. Geofencing works via the same Expo task path; Apple may delay background wakes—the refine step still applies. Car Bluetooth matching on iOS is **best-effort by connected audio/accessory name** (no full classic BT scan like Android).

## License / privacy notes

- No GateAuto cloud backend; credentials stay on-device (`expo-secure-store`).
- Opens go over HTTPS to PalGate’s API only.
- Not an official PalGate product.
