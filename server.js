// Static server + feedback endpoint + tiny analytics.
// Serves the Vite-built dist/ folder, accepts POST /api/feedback (Resend),
// tracks unique players + plays + total minutes via cookie + heartbeat.

import express from "express";
import { Resend } from "resend";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "32kb" }));

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO = process.env.FEEDBACK_TO || "yashar@yashimosh.com";
const FROM = process.env.FEEDBACK_FROM || "Border Run <feedback@send.yashimosh.com>";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Crude rate limit: token-bucket per IP, 5 messages per 10 minutes.
const buckets = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
function rateOk(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + RATE_LIMIT_WINDOW_MS; }
  bucket.count++;
  buckets.set(ip, bucket);
  return bucket.count <= RATE_LIMIT_MAX;
}

// ───── Analytics ─────────────────────────────────────────────────────────
// Tracks: unique players (by hashed cookie), total play sessions (each init()
// is a session), total play time (sum of heartbeats × heartbeat interval).
// State lives in /data/stats.json if /data is writable (Coolify volume),
// otherwise falls back to /tmp/stats.json (resets on container rebuild).

const STATS_PATH = await pickStatsPath();
const STATS_SALT = process.env.STATS_SALT || "border-run-static-salt-ok";
const HEARTBEAT_SEC = 30;

let stats = {
  uniquePlayers: 0, // count of distinct hashed cookies seen
  sessions: 0,      // count of /api/session POSTs
  playSeconds: 0,   // sum of heartbeats × HEARTBEAT_SEC
  // Hashed cookies of players we've seen (set, but persisted as array).
  seen: new Set(),
};
await loadStats();
let dirty = false;
setInterval(() => { if (dirty) { dirty = false; saveStats().catch(e => console.warn("[stats] save:", e.message)); } }, 5000);

async function pickStatsPath() {
  for (const dir of ["/data", "/tmp"]) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const probe = path.join(dir, ".write-probe");
      await fs.writeFile(probe, "x");
      await fs.unlink(probe);
      return path.join(dir, "border-run-stats.json");
    } catch {}
  }
  return path.join(__dirname, ".stats.json");
}

async function loadStats() {
  try {
    const raw = await fs.readFile(STATS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    stats.uniquePlayers = parsed.uniquePlayers || 0;
    stats.sessions = parsed.sessions || 0;
    stats.playSeconds = parsed.playSeconds || 0;
    stats.seen = new Set(parsed.seen || []);
    console.log(`[stats] loaded from ${STATS_PATH}: ${stats.uniquePlayers} players, ${stats.sessions} plays, ${(stats.playSeconds / 3600).toFixed(1)}h`);
  } catch {
    console.log(`[stats] starting fresh at ${STATS_PATH}`);
  }
}

async function saveStats() {
  const payload = {
    uniquePlayers: stats.uniquePlayers,
    sessions: stats.sessions,
    playSeconds: stats.playSeconds,
    seen: Array.from(stats.seen),
  };
  await fs.writeFile(STATS_PATH, JSON.stringify(payload), "utf8");
}

function cookieHash(token) {
  return createHash("sha256").update(STATS_SALT + ":" + token).digest("hex").slice(0, 24);
}

function readBrCookie(req) {
  const c = req.headers.cookie || "";
  const m = c.match(/(?:^|;\s*)br_pid=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function setBrCookie(res, token) {
  // Long-lived, lax, samesite, no path so it covers everything.
  res.setHeader("Set-Cookie", `br_pid=${token}; Max-Age=63072000; Path=/; SameSite=Lax`);
}

// POST /api/session — called when init() runs (one per "play").
app.post("/api/session", (req, res) => {
  let token = readBrCookie(req);
  if (!token) {
    token = randomBytes(12).toString("base64url");
    setBrCookie(res, token);
  }
  const hashed = cookieHash(token);
  if (!stats.seen.has(hashed)) {
    stats.seen.add(hashed);
    stats.uniquePlayers++;
  }
  stats.sessions++;
  dirty = true;
  res.json({ ok: true, unique: stats.uniquePlayers, plays: stats.sessions });
});

// POST /api/heartbeat — called every HEARTBEAT_SEC while playing.
app.post("/api/heartbeat", (req, res) => {
  stats.playSeconds += HEARTBEAT_SEC;
  dirty = true;
  res.json({ ok: true });
});

// GET /api/stats — public counts for the HUD.
app.get("/api/stats", (req, res) => {
  res.json({
    players: stats.uniquePlayers,
    plays: stats.sessions,
    hours: +(stats.playSeconds / 3600).toFixed(1),
  });
});

app.post("/api/feedback", async (req, res) => {
  const ip = (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "unknown").toString().split(",")[0].trim();
  if (!rateOk(ip)) return res.status(429).json({ error: "too many requests" });

  const { name, email, message, url, ua } = req.body || {};
  if (!message || typeof message !== "string" || message.trim().length < 2) {
    return res.status(400).json({ error: "message required" });
  }
  if (message.length > 4000) return res.status(400).json({ error: "message too long" });

  const safeName = (name || "anonymous").toString().slice(0, 80);
  const safeEmail = (email || "").toString().slice(0, 120);
  const safeUrl = (url || "").toString().slice(0, 200);
  const safeUA = (ua || "").toString().slice(0, 300);
  // Loose email validation — only used for replyTo, never blocks the send.
  const validEmail = safeEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail) ? safeEmail : null;

  if (!resend) {
    console.warn("[feedback] Resend not configured — message dropped:", { ip, name: safeName, message: message.slice(0, 80) });
    return res.status(503).json({ error: "feedback service not configured" });
  }

  const subject = `Border Run feedback — ${safeName}`;
  const text = [
    `From:  ${safeName}`,
    validEmail ? `Email: ${validEmail}` : `Email: (not provided)`,
    `IP:    ${ip}`,
    `URL:   ${safeUrl}`,
    `UA:    ${safeUA}`,
    "",
    "----",
    "",
    message,
  ].join("\n");

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: TO,
      subject,
      text,
      replyTo: validEmail || undefined,
    });
    if (result.error) {
      console.error("[feedback] resend error:", result.error);
      return res.status(502).json({ error: "send failed" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[feedback] exception:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// Health check.
app.get("/api/health", (req, res) => res.json({ ok: true, resendConfigured: !!resend }));

// Auto-discover radio tracks: any audio file dropped into public/radio/
// becomes a station automatically. The filename (without extension) is the
// station name. Underscores → spaces. Numeric prefix "01-" stripped for
// ordering control without showing up.
app.get("/api/radio-tracks", async (req, res) => {
  const dir = path.resolve(__dirname, "dist", "radio");
  try {
    const files = await fs.readdir(dir);
    const audio = files
      .filter((f) => /\.(mp3|ogg|wav|m4a)$/i.test(f))
      .sort()
      .map((f) => {
        const noExt = f.replace(/\.(mp3|ogg|wav|m4a)$/i, "");
        const noPrefix = noExt.replace(/^\d+[-_\s]+/, "");
        const name = noPrefix.replace(/_/g, " ").trim();
        return { name, url: `/radio/${encodeURIComponent(f)}` };
      });
    res.json({ tracks: audio });
  } catch (err) {
    res.json({ tracks: [] });
  }
});

// Serve the static build.
const distDir = path.resolve(__dirname, "dist");
app.use(express.static(distDir, { maxAge: "1h", etag: true }));
app.get("*", (req, res) => res.sendFile(path.join(distDir, "index.html")));

const PORT = parseInt(process.env.PORT || "4321", 10);
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`[border-run] serving on ${HOST}:${PORT}, resend=${!!resend ? "on" : "off"}`);
});
