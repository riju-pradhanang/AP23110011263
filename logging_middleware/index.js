/**
 * Reusable logging package that ships log entries to the Affordmed
 * evaluation test-server.  Drop this module into any Node.js project
 * and call Log(stack, level, pkg, message) anywhere you need observability.
 *
 * Signature:
 *   Log(stack, level, package, message)
 *
 * Valid values (all lower-case):
 *   stack   : "backend" | "frontend"
 *   level   : "debug" | "info" | "warn" | "error" | "fatal"
 *   package : see constraints in README / spec PDF
 *   message : free-form descriptive string
 */

"use strict";

const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const TEST_SERVER_BASE = "http://20.207.122.201/evaluation-service";

// ─── Valid constraint sets (guard against typos at call-sites) ──────────────
const VALID_STACKS = new Set(["backend", "frontend"]);
const VALID_LEVELS = new Set(["debug", "info", "warn", "error", "fatal"]);
const VALID_PACKAGES = new Set([
  // backend-only
  "cache", "controller", "cron_job", "db", "domain",
  "handler", "repository", "route", "service",
  // frontend-only
  "api", "component", "hook", "page", "state", "style",
  // shared
  "auth", "config", "middleware", "utils",
]);

// ─── Token cache ─────────────────────────────────────────────────────────────
let _cachedToken = null;

/**
 * Fetches a fresh Bearer token from the test-server using env credentials.
 * @returns {Promise<string>}
 */
async function getAuthToken() {
  const payload = {
    email:        process.env.AUTH_EMAIL,
    name:         process.env.AUTH_NAME,
    rollNo:       process.env.AUTH_ROLLNO,
    accessCode:   process.env.AUTH_ACCESS_CODE,
    clientID:     process.env.AUTH_CLIENT_ID,
    clientSecret: process.env.AUTH_CLIENT_SECRET,
  };

  // Fail fast with a clear message when credentials are missing
  if (!payload.email || !payload.clientID || !payload.clientSecret) {
    throw new Error(
      "[LogMiddleware] Missing auth credentials. " +
      "Ensure AUTH_EMAIL, AUTH_CLIENT_ID, AUTH_CLIENT_SECRET are set in .env"
    );
  }

  const response = await fetch(`${TEST_SERVER_BASE}/auth`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `[LogMiddleware] Auth token fetch failed (${response.status}): ${body}`
    );
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Internal helper — sends one POST to the logs endpoint.
 * @param {string} token
 * @param {object} body  { stack, level, package, message }
 * @returns {Promise<Response>}
 */
async function _postLog(token, body) {
  return fetch(`${TEST_SERVER_BASE}/logs`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Core reusable log function.
 *
 * @param {string} stack   "backend" | "frontend"
 * @param {string} level   "debug" | "info" | "warn" | "error" | "fatal"
 * @param {string} pkg     package identifier (see VALID_PACKAGES)
 * @param {string} message descriptive context about what is happening
 */
async function Log(stack, level, pkg, message) {
  // ── Input validation ──────────────────────────────────────────────────────
  if (!VALID_STACKS.has(stack)) {
    console.warn(`[LogMiddleware] Invalid stack "${stack}". Skipping log.`);
    return;
  }
  if (!VALID_LEVELS.has(level)) {
    console.warn(`[LogMiddleware] Invalid level "${level}". Skipping log.`);
    return;
  }
  if (!VALID_PACKAGES.has(pkg)) {
    console.warn(`[LogMiddleware] Invalid package "${pkg}". Skipping log.`);
    return;
  }

  const body = { stack, level, package: pkg, message };

  try {
    // ── Lazy-load & cache the Bearer token ───────────────────────────────────
    if (!_cachedToken) {
      _cachedToken = await getAuthToken();
    }

    let response = await _postLog(_cachedToken, body);

    // ── Token-refresh on 401 ──────────────────────────────────────────────────
    if (response.status === 401) {
      _cachedToken = await getAuthToken();
      response = await _postLog(_cachedToken, body);
    }

    if (!response.ok) {
      const errBody = await response.text();
      console.error(
        `[LogMiddleware] Log API returned ${response.status}: ${errBody}`
      );
    }
    // On success, return quietly — logging should never distract the caller
  } catch (err) {
    // Logging must NEVER crash the host application
    console.error(`[LogMiddleware] Failed to send log: ${err.message}`);
  }
}

module.exports = { Log };
