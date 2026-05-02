/**
 * notification_app_be/src/app.js
 *
 * Campus Notification Platform — Express REST API Entry Point
 *
 * Exposes:
 *   GET  /api/notifications              — all notifications (raw, from test server)
 *   GET  /api/notifications/priority     — top-N priority inbox (Stage 6)
 *   GET  /api/notifications/:id          — single notification by ID
 *   PATCH /api/notifications/:id/read    — mark as read (in-memory)
 *   PATCH /api/notifications/read-all   — mark all as read (in-memory)
 *
 * All incoming requests are logged via the reusable Log middleware.
 */

"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const express = require("express");
const { Log } = require("../../logging_middleware/index.js");
const notificationRoutes = require("./routes/notificationRoutes.js");

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());

// ─── Request-level logging middleware ─────────────────────────────────────────
app.use(async (req, _res, next) => {
  await Log(
    "backend", "info", "middleware",
    `Incoming ${req.method} ${req.originalUrl} from ${req.ip}`
  );
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/notifications", notificationRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "notification-app-be", uptime: process.uptime() });
});

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use(async (req, res) => {
  await Log("backend", "warn", "middleware",
    `404 — no route matched ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "Route not found" });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use(async (err, req, res, _next) => {
  await Log("backend", "error", "middleware",
    `Unhandled error on ${req.method} ${req.originalUrl}: ${err.message}`);
  res.status(500).json({ error: "Internal server error", detail: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  await Log("backend", "info", "config",
    `Notification backend started on port ${PORT}`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app; // exported for testing
