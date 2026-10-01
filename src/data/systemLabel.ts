const PLACEHOLDER_NAMES = new Set(['guest', 'signed in']);

function usablePersonName(raw?: string | null): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name || PLACEHOLDER_NAMES.has(name.toLowerCase())) return '';
  return name;
}

function phoneTail(phoneNumber: number): string {
  const digits = String(phoneNumber ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

/**
 * Name for a PalGate the user just scanned.
 * Stored labels are never passed through here again, so an existing
 * "Your PalGate" stays until the user renames it.
 * No real name (guest, blank) keeps the old default.
 */
export function scannedSystemLabel(input: {
  userName?: string | null;
  phoneNumber: number;
  /** 1-based count of owner-scanned systems, including this new one. */
  index: number;
}): string {
  const index =
    Number.isFinite(input.index) && input.index > 1 ? Math.floor(input.index) : 1;
  const tail = phoneTail(input.phoneNumber);
  const name = usablePersonName(input.userName);
  if (!name) {
    if (index <= 1) return tail ? `Your PalGate · ${tail}` : 'Your PalGate';
    return tail ? `Gate system ${index} · ${tail}` : `Gate system ${index}`;
  }
  const base = /pal\s*gate/i.test(name) ? name : `${name} PalGate`;
  const suffix = index <= 1 ? '' : tail ? ` · ${tail}` : ` ${index}`;
  const room = Math.max(1, 80 - suffix.length);
  return `${base.slice(0, room)}${suffix}`;
}
