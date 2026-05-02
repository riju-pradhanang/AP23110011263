"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const express = require("express");
const { Log } = require("../../logging_middleware/index.js");
const notificationRoutes = require("./routes/notificationRoutes.js");
const { authMiddleware } = require("./middleware/authMiddleware.js");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// FIX: was `Incoming ${req.method} ${req.originalUrl} from ${req.ip}` (56 chars) — TOO LONG
app.use(async (req, _res, next) => {
  await Log(
    "backend", "info", "middleware",
    `${req.method} ${req.originalUrl}`.substring(0, 48)
  );
  next();
});

// FIX: authMiddleware was defined but never applied — wired in here
app.use("/api/notifications", authMiddleware, notificationRoutes);

// Health check (no auth needed)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "notification-app-be", uptime: process.uptime() });
});

// FIX: was `404 — no route matched ${req.method} ${req.originalUrl}` (55 chars) — TOO LONG
app.use(async (req, res) => {
  await Log("backend", "warn", "middleware",
    `404: ${req.method} ${req.originalUrl}`.substring(0, 48));
  res.status(404).json({ error: "Route not found" });
});

// FIX: was `Unhandled error on ${req.method} ${req.originalUrl}: ${err.message}` (67+ chars) — TOO LONG
app.use(async (err, req, res, _next) => {
  await Log("backend", "error", "middleware",
    `Error ${req.method} ${req.originalUrl}`.substring(0, 48));
  res.status(500).json({ error: "Internal server error", detail: err.message });
});

// Start
app.listen(PORT, async () => {
  // "Notification backend started on port ${PORT}" is 44 chars — OK
  await Log("backend", "info", "config",
    `Notification backend started on port ${PORT}`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;