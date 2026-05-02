/**
 * Endpoints:
 *   GET    /                
 *   GET    /priority 
 *   GET    /:id
 *   PATCH  /read-all 
 *   PATCH  /:id/read
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
