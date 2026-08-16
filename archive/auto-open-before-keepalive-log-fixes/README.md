# Reference copy only — not compiled

Main app code is unchanged. Nothing in this folder is imported or built.

There is **no git commit** from before the three keep-alive log fixes. Native keepalive first appears in squash `99c5870`, and that squash already includes them:

1. 9-minute alarm: re-register geofences + `PalGateNativeOpen.pollNearby` (no location FGS from background)
2. Native HID/GATT profile checks (JS `getConnectedDevices` was empty)
3. Keep-alive GPS: JS stream High ~15s (Samsung ~2s GPS) → Balanced ~30s

## Layout

- `pre-log-fixes-from-transcript/` — recovered from the chat that applied those three edits (KeepAliveReceiver still starts headless JS on the alarm; PalGateNativeOpen is A2DP/HEADSET/GATT only; monitoring keep-alive is High / 15s). Other files are `99c5870` as they were not part of those three edits.
- `oldest-native-in-git-99c5870/` — oldest native keepalive still in git (already has the three fixes).
- `current-from-master/` — keepalive Java/JS as on disk when this archive was made (later safety commits plus any uncommitted GeofenceRegistrar tweak).

Do not restore these onto `master` unless you mean to.
