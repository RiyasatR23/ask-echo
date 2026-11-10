// Ask Echo — API proxy
// Keeps the Anthropic API key on the server, loads per-client config by clientId,
// enforces an origin allowlist and a simple per-IP rate limit.

import "dotenv/config";
import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_TURNS = 12; // only the last N messages are sent upstream
const MAX_CHARS = 2000; // per user message

if (!API_KEY) {
  console.warn("⚠  ANTHROPIC_API_KEY is not set — /api/chat will return 500.");
}

const app = express();
app.use(express.json({ limit: "32kb" }));

// Serve the widget and the demo page
app.use("/widget", express.static(path.join(ROOT, "widget")));
app.use("/", express.static(path.join(ROOT, "demo")));

// ---- client config -------------------------------------------------------
const cache = new Map();
async function loadClient(clientId) {
  if (!/^[a-z0-9-]{2,40}$/.test(clientId || "")) return null;
  if (cache.has(clientId)) return cache.get(clientId);
  try {
    const raw = await readFile(path.join(ROOT, "clients", `${clientId}.json`), "utf8");
    const cfg = JSON.parse(raw);
    cache.set(clientId, cfg);
    return cfg;
  } catch {
    return null;
  }
}

// ---- rate limit (in-memory, per IP) --------------------------------------
const WINDOW_MS = 60_000;
const LIMIT = 20;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

// ---- CORS per client -----------------------------------------------------
function applyCors(req, res, cfg) {
  const origin = req.headers.origin;
  const allowed = cfg?.allowedOrigins || [];
  if (origin && (allowed.includes("*") || allowed.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return true;
  }
  return !origin; // same-origin requests have no Origin header in some browsers
}

app.options("/api/chat", async (req, res) => {
  const cfg = await loadClient(req.query.clientId);
  applyCors(req, res, cfg);
  res.sendStatus(204);
});

// ---- public config for the widget (no secrets) ---------------------------
app.get("/api/config/:clientId", async (req, res) => {
  const cfg = await loadClient(req.params.clientId);
  if (!cfg) return res.status(404).json({ error: "Unknown client" });
  const { name, greeting, accentColor, suggestions } = cfg;
  res.json({ name, greeting, accentColor, suggestions });
});

// ---- chat ----------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { clientId, messages } = req.body || {};
  const cfg = await loadClient(clientId);
  if (!cfg) return res.status(404).json({ error: "Unknown client" });
  if (!applyCors(req, res, cfg)) return res.status(403).json({ error: "Origin not allowed" });
  if (rateLimited(req.ip)) return res.status(429).json({ error: "Too many messages, try again in a minute." });
  if (!API_KEY) return res.status(500).json({ error: "Server is missing its API key." });

  // Validate and trim the conversation
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }
  const clean = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_TURNS);
  if (clean[0]?.role !== "user") clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== "user") {
    return res.status(400).json({ error: "The last message must come from the user" });
  }

  const system = [
    `You are Echo, the website assistant for ${cfg.name}.`,
    cfg.systemPrompt,
    "Keep answers short (2-4 sentences) and friendly. If you don't know something, say so and point the visitor to the contact details.",
    cfg.knowledge ? `Business facts you can rely on:\n${cfg.knowledge}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages: clean }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      console.error("Anthropic error:", upstream.status, data?.error?.message);
      return res.status(502).json({ error: "The assistant is unavailable right now." });
    }
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "The assistant is unavailable right now." });
  }
});

app.listen(PORT, () => {
  console.log(`Ask Echo running on http://localhost:${PORT}`);
});
