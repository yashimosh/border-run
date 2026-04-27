// Static server + feedback endpoint.
// Serves the Vite-built dist/ folder and accepts POST /api/feedback,
// forwarding messages to yashar@yashimosh.com via Resend.

import express from "express";
import { Resend } from "resend";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

app.post("/api/feedback", async (req, res) => {
  const ip = (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "unknown").toString().split(",")[0].trim();
  if (!rateOk(ip)) return res.status(429).json({ error: "too many requests" });

  const { name, message, url, ua } = req.body || {};
  if (!message || typeof message !== "string" || message.trim().length < 2) {
    return res.status(400).json({ error: "message required" });
  }
  if (message.length > 4000) return res.status(400).json({ error: "message too long" });

  const safeName = (name || "anonymous").toString().slice(0, 80);
  const safeUrl = (url || "").toString().slice(0, 200);
  const safeUA = (ua || "").toString().slice(0, 300);

  if (!resend) {
    console.warn("[feedback] Resend not configured — message dropped:", { ip, name: safeName, message: message.slice(0, 80) });
    return res.status(503).json({ error: "feedback service not configured" });
  }

  const subject = `Border Run feedback — ${safeName}`;
  const text = [
    `From: ${safeName}`,
    `IP:   ${ip}`,
    `URL:  ${safeUrl}`,
    `UA:   ${safeUA}`,
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
      replyTo: undefined,
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

// Serve the static build.
const distDir = path.resolve(__dirname, "dist");
app.use(express.static(distDir, { maxAge: "1h", etag: true }));
app.get("*", (req, res) => res.sendFile(path.join(distDir, "index.html")));

const PORT = parseInt(process.env.PORT || "4321", 10);
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`[border-run] serving on ${HOST}:${PORT}, resend=${!!resend ? "on" : "off"}`);
});
