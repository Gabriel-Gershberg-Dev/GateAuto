export {
  haversineMeters, type LatLng } from './haversine';
export { cooldownRemainingMs } from './cooldown';
export {
  refineArrival,
  assertNearGate,
  accuracyAcceptable,
  REFINE_RADIUS_FACTOR,
  OPEN_RADIUS_FACTOR,
  EXIT_RADIUS_FACTOR,
  MAX_REFINE_ACCURACY_M,
  GOOD_REFINE_ACCURACY_M,
  ABSOLUTE_MAX_OPEN_DISTANCE_M,
  MAX_LOCATION_AGE_MS,
  MAX_REFINE_ATTEMPTS,
  type RefineResult,
  type RefineTrigger,
  type LocationFix,
} from './refine';
export {
  GEOFENCE_TASK_NAME,
  LOCATION_WATCH_TASK_NAME,
  startMonitoring,
  stopMonitoring,
  isMonitoringEnabled,
  syncGeofences,
  getMonitoringArmStatus,
  handleGeofenceEnter,
  handleGeofenceExit,
  handleBluetoothDeviceConnected,
  checkEligibleNowAndOpen,
  runEligibilityPoll,
  testAutoOpenConditions,
  type GateConfig,
  type MonitoringArmStatus,
} from './geofencing';
export {
  resyncMonitoringIfArmed,
  startMonitoringResyncLifecycle,
} from './monitoringResync';
export {
  LINKING_WATCH_TASK_NAME,
  startLinkingForegroundWatch,
  stopLinkingForegroundWatch,
} from './linkingKeepAlive';
export {
  MONITORING_KEEPALIVE_TASK_NAME,
  MONITORING_POLL_WAKE_INTERVAL_MS,
  startMonitoringKeepAlive,
  stopMonitoringKeepAlive,
} from './monitoringKeepAlive';
