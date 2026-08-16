/**
 * App-wide open result banners (manual + auto). Screens can also keep local
 * banners; this host ensures Monitoring / background opens still show feedback.
 */

import type { OpenBanner } from './components/OpenResultBanners';

type Listener = (banner: OpenBanner) => void;

const listeners = new Set<Listener>();

export function publishOpenResult(
  gateId: string,
  name: string,
  success: boolean,
  message: string,
): void {
  const banner: OpenBanner = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    gateId,
    name,
    success,
    message,
  };
  for (const listener of listeners) {
    try {
      listener(banner);
    } catch (error) {
      console.warn('[GateAuto] openResultBus listener failed', error);
    }
  }
}

export function subscribeOpenResults(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
