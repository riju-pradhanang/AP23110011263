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
    await Log("backend", "warn", "auth",
      `Unauthenticated request to ${req.method} ${req.originalUrl} — missing Bearer token`);
    return res.status(401).json({
      error: "Unauthorized",
      message: "Authorization header with Bearer token is required",
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    await Log("backend", "warn", "auth",
      `Empty Bearer token on ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: "Unauthorized", message: "Token is empty" });
  }

  // Attach token to request so controllers/services can pass it downstream
  req.bearerToken = token;
  await Log("backend", "debug", "auth",
    `Bearer token present for ${req.method} ${req.originalUrl}`);
  next();
}

module.exports = { authMiddleware };
