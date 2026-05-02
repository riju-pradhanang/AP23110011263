// HTTP request/response layer — thin adapter between Express routes

"use strict";

const svc = require("../services/notificationService.js");
const { Log } = require("../../../logging_middleware/index.js");

// GET /api/notifications
async function getAllNotifications(req, res) {
  try {
    await Log("backend", "debug", "controller",
      "getAllNotifications invoked");

    const { isRead } = req.query;
    let notifications = await svc.getAllNotifications();

    if (isRead !== undefined) {
      const flag = isRead === "true";
      notifications = notifications.filter((n) => n.isRead === flag);
      await Log("backend", "debug", "controller",
        // FIX: "Filtered by isRead=true: 99 results" is 36 chars — fine
        `Filtered isRead=${flag}: ${notifications.length} results`);
    }

    res.status(200).json({
      count: notifications.length,
      notifications,
    });
  } catch (err) {
    // FIX: was `getAllNotifications failed: ${err.message}` — can exceed 48
    await Log("backend", "error", "controller",
      `getAllNotifications failed`.substring(0, 48));
    res.status(500).json({ error: err.message });
  }
}

// GET /api/notifications/priority?n=10
async function getPriorityNotifications(req, res) {
  try {
    const n = parseInt(req.query.n, 10) || 10;

    if (n < 1 || n > 100) {
      // FIX: was `Invalid n=${n} for priority inbox — must be 1–100` (48 chars exactly but with em-dash may be longer in bytes) — trim to be safe
      await Log("backend", "warn", "controller",
        `Invalid n=${n}: must be 1-100`);
      return res.status(400).json({
        error: "Validation error",
        message: "Query param 'n' must be between 1 and 100",
      });
    }

    await Log("backend", "debug", "controller",
      `getPriorityNotifications n=${n}`);

    const top = await svc.getTopNNotifications(n);

    res.status(200).json({
      count: top.length,
      notifications: top,
    });
  } catch (err) {
    await Log("backend", "error", "controller",
      `getPriorityNotifications failed`);
    res.status(500).json({ error: err.message });
  }
}

// GET /api/notifications/:id
async function getNotificationById(req, res) {
  try {
    const { id } = req.params;
    // FIX: was `getNotificationById invoked for ID: ${id}` (50+ chars) — TOO LONG
    await Log("backend", "debug", "controller",
      `getById: ${id}`.substring(0, 48));

    const notification = await svc.getNotificationById(id);

    if (!notification) {
      return res.status(404).json({
        error: "Not found",
        message: `Notification ${id} does not exist`,
      });
    }

    res.status(200).json({ notification });
  } catch (err) {
    await Log("backend", "error", "controller",
      `getNotificationById failed`);
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/notifications/:id/read
async function markAsRead(req, res) {
  try {
    const { id } = req.params;
    // FIX: was `markAsRead invoked for notification ID: ${id}` (49+ chars) — TOO LONG
    await Log("backend", "info", "controller",
      `markAsRead: ${id}`.substring(0, 48));

    const notification = await svc.getNotificationById(id);
    if (!notification) {
      return res.status(404).json({
        error: "Not found",
        message: `Notification ${id} does not exist`,
      });
    }

    await svc.markAsRead(id);
    res.status(200).json({ message: "Notification marked as read", id });
  } catch (err) {
    await Log("backend", "error", "controller",
      `markAsRead failed`);
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/notifications/read-all
async function markAllAsRead(req, res) {
  try {
    await Log("backend", "info", "controller",
      "markAllAsRead invoked");

    const count = await svc.markAllAsRead();
    res.status(200).json({
      message: `Marked ${count} notifications as read`,
      markedCount: count,
    });
  } catch (err) {
    await Log("backend", "error", "controller",
      `markAllAsRead failed`);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getAllNotifications,
  getPriorityNotifications,
  getNotificationById,
  markAsRead,
  markAllAsRead,
};