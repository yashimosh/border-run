// Analytics — talks to the server's /api/session, /api/heartbeat, /api/stats.
// Privacy: server stores hashed cookie tokens and aggregate counts, no PII.

const HEARTBEAT_MS = 30_000;
let heartbeatTimer: number | undefined;

export interface PublicStats {
  players: number;
  plays: number;
  hours: number;
}

export async function fetchStats(): Promise<PublicStats | null> {
  try {
    const res = await fetch("/api/stats", { credentials: "same-origin" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function recordSession() {
  fetch("/api/session", { method: "POST", credentials: "same-origin" }).catch(() => {});
  // Start heartbeats; visibility API pauses them when the tab is hidden.
  startHeartbeats();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopHeartbeats();
    else startHeartbeats();
  });
}

function startHeartbeats() {
  if (heartbeatTimer != null) return;
  heartbeatTimer = window.setInterval(() => {
    if (document.hidden) return;
    fetch("/api/heartbeat", { method: "POST", credentials: "same-origin" }).catch(() => {});
  }, HEARTBEAT_MS);
}

function stopHeartbeats() {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

export function formatStats(s: PublicStats): string {
  // "423 played · 1,200 plays · 38h" — concise, lowercase, register-fitting.
  const fmt = (n: number) => n.toLocaleString();
  return `${fmt(s.players)} played · ${fmt(s.plays)} runs · ${s.hours}h`;
}
