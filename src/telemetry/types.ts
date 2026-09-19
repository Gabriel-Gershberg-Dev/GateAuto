export const TELEMETRY_EVENTS = {
  autoOpen: 'auto_open',
  autoSkip: 'auto_skip',
  keepaliveTick: 'keepalive_tick',
  permissionState: 'permission_state',
  settingsSave: 'settings_save',
} as const;

export type AutoOpenSource =
  | 'play_enter'
  | 'play_exit'
  | 'bt'
  | 'poll'
  | 'recover'
  | 'manual';

export type AutoSkipReason =
  | 'cooldown'
  | 'outside_radius'
  | 'bt_missing'
  | 'safety_lock'
  | 'heading'
  | 'hung'
  | 'other';

export type KeepaliveTickResult = 'ok' | 'skip' | 'hung_killed';

export type AutoOpenPayload = {
  source: AutoOpenSource;
  gateHash?: string;
  distanceM?: number;
  radiusM?: number;
  btRequired?: boolean;
  /** Trigger→open latency in ms (native cold path measures this; JS opens omit). */
  latencyMs?: number;
  /** true if the process/location FGS was warm; false = cold-wake. */
  warm?: boolean;
};

export type AutoSkipPayload = {
  reason: AutoSkipReason;
  source?: AutoOpenSource;
  gateHash?: string;
  distanceM?: number;
  radiusM?: number;
};

export type PermissionStatePayload = {
  alwaysLoc: boolean;
  notifications: boolean;
  btConnect: boolean;
  batteryUnrestricted: boolean;
};

export type SettingsSavePayload = {
  changedRadius: boolean;
  changedBt: boolean;
  radiusM?: number;
  btRequired?: boolean;
};

export type MappedTelemetry =
  | ({ type: 'auto_open' } & AutoOpenPayload)
  | ({ type: 'auto_skip' } & AutoSkipPayload);
