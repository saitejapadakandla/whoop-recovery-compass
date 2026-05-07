import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const dataRoot = join(root, "data");
const tokenPath = join(dataRoot, "tokens.json");
const statePath = join(dataRoot, "oauth-state.json");
const certPath = join(dataRoot, "localhost-cert.pem");
const keyPath = join(dataRoot, "localhost-key.pem");

loadEnv(join(root, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_LOCAL_HOST = "127.0.0.1";
const SESSION_COOKIE = "rc_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";
const DEFAULT_SCOPES = "read:profile read:body_measurement read:workout read:recovery read:sleep read:cycles offline";

function loadEnv(path) {
  try {
    const text = requireText(path);
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Missing .env is handled by /api/status and the connection screen.
  }
}

function requireText(path) {
  return readFileSync(path, "utf8");
}

function getConfig() {
  return {
    clientId: process.env.WHOOP_CLIENT_ID || "",
    clientSecret: process.env.WHOOP_CLIENT_SECRET || "",
    redirectUri: process.env.WHOOP_REDIRECT_URI || `https://${DEFAULT_LOCAL_HOST}:${PORT}/callback`,
    scopes: process.env.WHOOP_SCOPES || DEFAULT_SCOPES,
  };
}

async function ensureDataDir() {
  await mkdir(dataRoot, { recursive: true });
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

async function writeJson(path, value) {
  await ensureDataDir();
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function hasFile(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function parseUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || (getConfig().redirectUri.startsWith("https://") ? "https" : "http");
  const host = req.headers.host || `${HOST}:${PORT}`;
  return new URL(req.url || "/", `${protocol}://${host}`);
}

function isOAuthCallback(pathname) {
  return pathname === "/callback" || pathname === "/auth/whoop/callback";
}

function appAuthRequired() {
  return Boolean(process.env.APP_PASSWORD);
}

function sessionSecret() {
  return process.env.APP_SESSION_SECRET || process.env.WHOOP_CLIENT_SECRET || "recovery-compass-local-dev";
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        if (index === -1) return [item, ""];
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      }),
  );
}

function sign(value) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function createSessionToken() {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < Date.now()) return false;
  return safeEqual(signature, sign(expiresAt));
}

function isAppAuthenticated(req) {
  if (!appAuthRequired()) return true;
  return verifySessionToken(parseCookies(req)[SESSION_COOKIE]);
}

function isSecureCookie(req) {
  return Boolean(req.socket.encrypted) || req.headers["x-forwarded-proto"] === "https";
}

function sessionCookie(token, req) {
  const secure = isSecureCookie(req) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function loginPage(error = "") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Recovery Compass Login</title>
    <style>
      :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #fff; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: linear-gradient(135deg, #fff, #f8fafc); }
      main { width: min(420px, 100%); border: 1px solid #e6e8ec; border-radius: 8px; padding: 28px; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.07); }
      .mark { width: 44px; height: 44px; border-radius: 7px; display: grid; place-items: center; background: #111827; color: #fff; font-weight: 800; margin-bottom: 18px; }
      h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.15; }
      p { margin: 0 0 22px; color: #667085; line-height: 1.5; }
      label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #667085; margin-bottom: 8px; }
      input { width: 100%; min-height: 44px; border: 1px solid #d0d5dd; border-radius: 7px; padding: 0 12px; font: inherit; }
      button { width: 100%; min-height: 44px; margin-top: 14px; border: 0; border-radius: 7px; background: #111827; color: #fff; font: inherit; font-weight: 750; cursor: pointer; }
      .error { color: #b42318; background: #fff0ed; border: 1px solid #ffc3bb; padding: 10px 12px; border-radius: 7px; margin-bottom: 14px; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">RC</div>
      <h1>Recovery Compass</h1>
      <p>This hosted app is private. Enter the app password to continue.</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
      <form method="post" action="/login">
        <label for="password">App password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus />
        <button type="submit">Unlock</button>
      </form>
    </main>
  </body>
</html>`;
}

function assertConfigured() {
  const config = getConfig();
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    const missing = [];
    if (!config.clientId) missing.push("WHOOP_CLIENT_ID");
    if (!config.clientSecret) missing.push("WHOOP_CLIENT_SECRET");
    if (!config.redirectUri) missing.push("WHOOP_REDIRECT_URI");
    const error = new Error(`Missing ${missing.join(", ")}`);
    error.status = 500;
    throw error;
  }
  return config;
}

async function createAuthUrl() {
  const config = assertConfigured();
  const state = randomBytes(16).toString("hex");
  await writeJson(statePath, { state, createdAt: Date.now() });

  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode(code, returnedState) {
  const config = assertConfigured();
  const saved = await readJson(statePath);
  if (!returnedState || returnedState !== saved.state) {
    const error = new Error("OAuth state mismatch. Start the connection flow again.");
    error.status = 400;
    throw error;
  }

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`WHOOP token exchange failed: ${text}`);
    error.status = response.status;
    throw error;
  }

  const tokens = await response.json();
  await saveTokens(tokens);
  try {
    await unlink(statePath);
  } catch {}
}

async function saveTokens(tokens) {
  const now = Math.floor(Date.now() / 1000);
  const existing = (await hasFile(tokenPath)) ? await readJson(tokenPath) : {};
  const merged = {
    ...existing,
    ...tokens,
    refresh_token: tokens.refresh_token || existing.refresh_token,
    expires_at: now + Number(tokens.expires_in || 3600) - 60,
    saved_at: new Date().toISOString(),
  };
  await writeJson(tokenPath, merged);
}

async function refreshTokens(tokens) {
  const config = assertConfigured();
  if (!tokens.refresh_token) {
    const error = new Error("Missing refresh token. Reconnect WHOOP.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scopes,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`WHOOP token refresh failed: ${text}`);
    error.status = 401;
    throw error;
  }

  const nextTokens = await response.json();
  await saveTokens(nextTokens);
  return readJson(tokenPath);
}

async function getValidTokens() {
  if (!(await hasFile(tokenPath))) {
    const error = new Error("WHOOP is not connected.");
    error.status = 401;
    throw error;
  }
  let tokens = await readJson(tokenPath);
  const now = Math.floor(Date.now() / 1000);
  if (!tokens.access_token || !tokens.expires_at || tokens.expires_at <= now) {
    tokens = await refreshTokens(tokens);
  }
  return tokens;
}

async function whoopFetch(path, params = {}) {
  const tokens = await getValidTokens();
  const url = new URL(`${WHOOP_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`WHOOP API ${response.status}: ${text}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function whoopCollection(path, params, maxPages = 4) {
  let nextToken = params.nextToken;
  const records = [];
  let pages = 0;

  do {
    const payload = await whoopFetch(path, { ...params, nextToken });
    if (Array.isArray(payload.records)) records.push(...payload.records);
    else if (Array.isArray(payload)) records.push(...payload);
    else if (payload && Object.keys(payload).length) records.push(payload);
    nextToken = payload.next_token || payload.nextToken || "";
    pages += 1;
  } while (nextToken && pages < maxPages);

  return { records, nextToken: nextToken || null, pages };
}

function isoDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

async function getDashboard(days) {
  const end = new Date().toISOString();
  const start = isoDaysAgo(days);
  const params = { start, end, limit: 25 };

  const [profileResult, bodyResult, recovery, sleep, cycle, workout] = await Promise.allSettled([
    whoopFetch("/user/profile/basic"),
    whoopFetch("/user/measurement/body"),
    whoopCollection("/recovery", params),
    whoopCollection("/activity/sleep", params),
    whoopCollection("/cycle", params),
    whoopCollection("/activity/workout", params),
  ]);

  const errors = [];
  const value = (result, label, fallback) => {
    if (result.status === "fulfilled") return result.value;
    errors.push({ label, message: result.reason.message || String(result.reason) });
    return fallback;
  };

  return {
    fetchedAt: new Date().toISOString(),
    range: { start, end, days },
    profile: value(profileResult, "profile", null),
    body: value(bodyResult, "body", null),
    recovery: value(recovery, "recovery", { records: [] }).records,
    sleep: value(sleep, "sleep", { records: [] }).records,
    cycle: value(cycle, "cycle", { records: [] }).records,
    workout: value(workout, "workout", { records: [] }).records,
    errors,
  };
}

async function statusPayload() {
  const config = getConfig();
  const hasTokens = await hasFile(tokenPath);
  let tokenStatus = null;
  if (hasTokens) {
    const tokens = await readJson(tokenPath);
    tokenStatus = {
      expiresAt: tokens.expires_at || null,
      savedAt: tokens.saved_at || null,
      scopes: tokens.scope || "",
      hasRefreshToken: Boolean(tokens.refresh_token),
    };
  }

  return {
    configured: Boolean(config.clientId && config.clientSecret && config.redirectUri),
    authenticated: hasTokens,
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    tokenStatus,
  };
}

async function serveStatic(req, res) {
  const url = parseUrl(req);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(publicRoot, pathname));
  if (!filePath.startsWith(publicRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    await stat(filePath);
    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(404);
      res.end("Not Found");
    });
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    }[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    stream.pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

async function route(req, res) {
  const url = parseUrl(req);

  try {
    if (appAuthRequired() && url.pathname === "/login" && req.method === "GET") {
      sendHtml(res, 200, loginPage());
      return;
    }

    if (appAuthRequired() && url.pathname === "/login" && req.method === "POST") {
      const body = new URLSearchParams(await readBody(req));
      if (body.get("password") === process.env.APP_PASSWORD) {
        redirect(res, "/", { "Set-Cookie": sessionCookie(createSessionToken(), req) });
        return;
      }
      sendHtml(res, 401, loginPage("Incorrect app password."));
      return;
    }

    if (!appAuthRequired() && url.pathname === "/login") {
      redirect(res, "/");
      return;
    }

    if (!isAppAuthenticated(req) && !isOAuthCallback(url.pathname)) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 401, { error: "App password required." });
        return;
      }
      redirect(res, "/login");
      return;
    }

    if (url.pathname === "/api/status") {
      sendJson(res, 200, await statusPayload());
      return;
    }

    if (url.pathname === "/api/auth-url") {
      sendJson(res, 200, { url: await createAuthUrl() });
      return;
    }

    if (url.pathname === "/auth/whoop") {
      redirect(res, await createAuthUrl());
      return;
    }

    if (url.pathname === "/callback" || url.pathname === "/auth/whoop/callback") {
      const error = url.searchParams.get("error");
      if (error) throw Object.assign(new Error(`WHOOP authorization failed: ${error}`), { status: 400 });
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code) throw Object.assign(new Error("Missing OAuth code."), { status: 400 });
      await exchangeCode(code, state);
      redirect(res, "/?connected=1");
      return;
    }

    if (url.pathname === "/api/dashboard") {
      const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days") || 30)));
      sendJson(res, 200, await getDashboard(days));
      return;
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      try {
        await unlink(tokenPath);
      } catch {}
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Unknown API route" });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Unknown error" });
  }
}

await ensureDataDir();
const config = getConfig();
const redirectUrl = new URL(config.redirectUri);
const redirectIsLocal = ["127.0.0.1", "localhost"].includes(redirectUrl.hostname);
const useHttps =
  process.env.LOCAL_HTTPS === "true" ||
  (process.env.LOCAL_HTTPS !== "false" && redirectUrl.protocol === "https:" && redirectIsLocal);
const server = useHttps
  ? createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, route)
  : createServer(route);
server.listen(PORT, HOST, () => {
  console.log(`Recovery Compass running at ${useHttps ? "https" : "http"}://${HOST}:${PORT}`);
});
