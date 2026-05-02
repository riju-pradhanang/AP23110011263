/**
 * Simple Bearer-token authentication middleware for the notification API.
 *
 * Clients must send:
 *   Authorization: Bearer <token>
 *
 * The token is validated by checking it exists and is non-empty.
 */

"use strict";

const { Log } = require("../../../logging_middleware/index.js");

// Express middleware — rejects requests without a valid Authorization header.
async function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"] || "";

  if (!authHeader.startsWith("Bearer ")) {
    // FIX: was `Unauthenticated request to ${req.method} ${req.originalUrl} — missing Bearer token` (72+ chars) — TOO LONG
    await Log("backend", "warn", "auth",
      `No Bearer token: ${req.method} ${req.originalUrl}`.substring(0, 48));
    return res.status(401).json({
      error: "Unauthorized",
      message: "Authorization header with Bearer token is required",
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    // FIX: was `Empty Bearer token on ${req.method} ${req.originalUrl}` — can exceed 48 with long URLs
    await Log("backend", "warn", "auth",
      `Empty token: ${req.method} ${req.originalUrl}`.substring(0, 48));
    return res.status(401).json({ error: "Unauthorized", message: "Token is empty" });
  }

  // Attach token to request so controllers/services can pass it downstream
  req.bearerToken = token;
  // FIX: was `Bearer token present for ${req.method} ${req.originalUrl}` (47-60+ chars) — can exceed
  await Log("backend", "debug", "auth",
    `Auth OK: ${req.method} ${req.originalUrl}`.substring(0, 48));
  next();
}

module.exports = { authMiddleware };