/**
 * notification_app_be/src/routes/notificationRoutes.js
 *
 * REST API route definitions for the Campus Notification Platform.
 *
 * Base path (mounted in app.js): /api/notifications
 *
 * Endpoints:
 *   GET    /                  — list all notifications (supports ?isRead=true|false)
 *   GET    /priority          — top-N priority inbox (supports ?n=10)
 *   GET    /:id               — fetch one notification by ID
 *   PATCH  /read-all          — mark all notifications as read
 *   PATCH  /:id/read          — mark a single notification as read
 *
 * NOTE: /priority and /read-all MUST be declared BEFORE /:id so Express
 *       does not treat "priority" or "read-all" as a dynamic :id segment.
 */

"use strict";

const { Router } = require("express");
const ctrl = require("../controllers/notificationController.js");

const router = Router();

// Static paths first — order matters in Express
router.get("/priority",       ctrl.getPriorityNotifications);
router.patch("/read-all",     ctrl.markAllAsRead);

// Parameterised paths last
router.get("/",               ctrl.getAllNotifications);
router.get("/:id",            ctrl.getNotificationById);
router.patch("/:id/read",     ctrl.markAsRead);

module.exports = router;
