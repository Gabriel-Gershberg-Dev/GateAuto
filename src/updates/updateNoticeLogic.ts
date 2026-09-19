export function shouldPostUpdateNotice(opts: {
  enabled: boolean;
  /** Master shade switch. Missing / true = allowed. */
  allEnabled?: boolean;
  willOffer: boolean;
  versionCode: number;
  lastNotifiedCode: number;
}): boolean {
  if (opts.allEnabled === false) return false;
  if (!opts.enabled || !opts.willOffer) return false;
  const code = Number.isFinite(opts.versionCode)
    ? Math.trunc(opts.versionCode)
    : 0;
  if (!(code > 0)) return false;
  return code !== opts.lastNotifiedCode;
}
