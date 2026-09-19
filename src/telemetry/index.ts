export { hashGateId } from './privacy';
export { mapLogEvent } from './mapLogEvent';
export { reportFromLogEvent } from './fromLogEvent';
export { TELEMETRY_EVENTS } from './types';
export type {
  AutoOpenSource,
  AutoSkipReason,
  KeepaliveTickResult,
  AutoOpenPayload,
  AutoSkipPayload,
  PermissionStatePayload,
  SettingsSavePayload,
} from './types';

export {
  breadcrumb,
  emitMapped,
  logAutoOpen,
  logAutoSkip,
  logKeepaliveTick,
  logPermissionState,
  logSettingsSave,
  recordUnexpected,
  setCrashKeys,
  setTelemetryUser,
} from './native';
