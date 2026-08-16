#!/usr/bin/env python3
"""Probe PalGate secondary/init long-poll behavior."""
import json
import time
import uuid
import urllib.error
import urllib.request

BASE = "https://api1.pal-es.com/v1/bt/un/secondary/init/"
UA = "okhttp/4.9.3"


def probe(timeout_s: float, label: str, reuse_uuid: str | None = None) -> str:
    u = reuse_uuid or str(uuid.uuid4())
    qr = json.dumps({"id": u}, separators=(", ", ": "))  # wrong
    qr_pylgate = '{"id": "%s"}' % u
    qr_compact = json.dumps({"id": u}, separators=(",", ":"))
    print(f"\n=== {label} ===")
    print(f"UUID={u}")
    print(f"QR_PYLGATE={qr_pylgate}")
    print(f"QR_COMPACT={qr_compact}")
    req = urllib.request.Request(
        BASE + u,
        headers={"User-Agent": UA, "Accept": "*/*", "Content-Type": "application/json"},
    )
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            elapsed = time.time() - start
            print(f"STATUS={resp.status} ELAPSED={elapsed:.1f}s")
            print(f"HEADERS={dict(resp.headers)}")
            print(f"BODY={body[:800]}")
    except Exception as e:
        elapsed = time.time() - start
        print(f"ELAPSED={elapsed:.1f}s ERR={type(e).__name__}: {e}")
        if isinstance(e, urllib.error.HTTPError):
            body = e.read().decode("utf-8", errors="replace")
            print(f"HTTP_STATUS={e.code} BODY={body[:800]}")
    return u


if __name__ == "__main__":
    u = probe(20, "fresh uuid 20s (expect hang/timeout)")
    probe(8, "same uuid again 8s (already waiting?)", reuse_uuid=u)
