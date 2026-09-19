/**
 * Expo Location / TaskManager rejections that happen before Always location
 * (and similar) are granted. Technical — not for the Gates red error banner.
 */

function collectErrorText(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const coded = error as Error & { code?: unknown; cause?: unknown };
    return [
      error.name,
      error.message,
      coded.code != null ? String(coded.code) : '',
      coded.cause != null ? collectErrorText(coded.cause) : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (typeof error === 'object') {
    const row = error as { message?: unknown; code?: unknown; cause?: unknown };
    return [
      row.message != null ? String(row.message) : '',
      row.code != null ? String(row.code) : '',
      row.cause != null ? collectErrorText(row.cause) : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return String(error);
}

/**
 * True when the failure is an expected native probe/start before location,
 * background location, geofence, keep-alive FGS, or TaskManager is allowed.
 */
export function isExpectedPrePermissionNativeError(error: unknown): boolean {
  const text = collectErrorText(error).toLowerCase();
  if (!text) return false;

  if (text.includes('hasstarted')) return true;

  if (
    text.includes('not authorized to use') &&
    text.includes('location')
  ) {
    return true;
  }

  if (
    /err_location|locationbackgroundunauthorized|locationunauthorized/.test(
      text,
    )
  ) {
    return true;
  }

  if (
    text.includes('background location') &&
    /(permission|not authorized|denied|not granted|unauthorized)/.test(text)
  ) {
    return true;
  }

  if (
    text.includes('call to function') &&
    text.includes('has been rejected')
  ) {
    return /expolocation|expo.?location|expotaskmanager|taskmanager|geofenc|keepalive|location/.test(
      text,
    );
  }

  return false;
}
