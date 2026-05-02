/**
 * notification_app_be/src/services/notificationService.js
 *
 * Service layer — all business logic for the notification platform.
 *
 * Responsibilities:
 *   1. Authenticate with the test server and fetch raw notifications
 *   2. In-memory read-state tracking (isRead per notification ID)
 *   3. Priority Inbox — Stage 6
 *      Uses a Min-Heap of size N to compute the top-N notifications
 *      by a composite score:
 *        score = typeWeight × 10^12 + timestampMilliseconds
 *      where Placement=3, Result=2, Event=1.
 *      Multiplying by 10^12 ensures type always dominates recency.
 *
 *   Min-Heap guarantees O(log N) per insertion and O(n log N) total,
 *   making it suitable for streaming — new notifications can be evaluated
 *   against the heap root in O(log N) without reprocessing the full set.
 */

"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });

const { Log } = require("../../../logging_middleware/index.js");

const TEST_SERVER_BASE = "http://20.207.122.201/evaluation-service";

// ─── Type weights (Placement > Result > Event) ───────────────────────────────
const TYPE_WEIGHT = { Placement: 3, Result: 2, Event: 1 };

// ─── In-memory read state: Map<notificationID, boolean> ─────────────────────
// In production this would live in the database; here it survives the
// lifetime of the Node process.
const _readState = new Map();

// ─── Token cache ──────────────────────────────────────────────────────────────
let _cachedToken = null;

async function _getAuthToken() {
  const payload = {
    email:        process.env.AUTH_EMAIL,
    name:         process.env.AUTH_NAME,
    rollNo:       process.env.AUTH_ROLLNO,
    accessCode:   process.env.AUTH_ACCESS_CODE,
    clientID:     process.env.AUTH_CLIENT_ID,
    clientSecret: process.env.AUTH_CLIENT_SECRET,
  };

  const res = await fetch(`${TEST_SERVER_BASE}/auth`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Auth failed (${res.status}): ${txt}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function _getToken() {
  if (!_cachedToken) {
    _cachedToken = await _getAuthToken();
    await Log("backend", "debug", "auth",
      "Notification service: Bearer token obtained and cached");
  }
  return _cachedToken;
}

// ─── Raw fetch from test server ───────────────────────────────────────────────

async function _fetchFromServer() {
  await Log("backend", "info", "service",
    "Fetching notifications from test server");

  let token;
  try {
    token = await _getToken();
  } catch (err) {
    await Log("backend", "error", "auth",
      `Failed to obtain auth token in notification service: ${err.message}`);
    throw err;
  }

  const res = await fetch(`${TEST_SERVER_BASE}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Refresh token once on 401
  if (res.status === 401) {
    await Log("backend", "warn", "auth",
      "Token expired fetching notifications — refreshing");
    _cachedToken = await _getAuthToken();
    const retry = await fetch(`${TEST_SERVER_BASE}/notifications`, {
      headers: { Authorization: `Bearer ${_cachedToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Notifications API error after refresh: ${retry.status}`);
    }
    const d = await retry.json();
    return d.notifications;
  }

  if (!res.ok) {
    await Log("backend", "error", "service",
      `Notifications API returned ${res.status}`);
    throw new Error(`Notifications API error: ${res.status}`);
  }

  const data = await res.json();
  await Log("backend", "info", "service",
    `Fetched ${data.notifications.length} notifications from test server`);
  return data.notifications;
}

// ─── Public: get all notifications (with in-memory isRead state) ─────────────

async function getAllNotifications() {
  const raw = await _fetchFromServer();

  // Attach isRead flag — default false for new IDs
  return raw.map((n) => ({
    ...n,
    isRead: _readState.get(n.ID) ?? false,
  }));
}

// ─── Public: get single notification by ID ────────────────────────────────────

async function getNotificationById(id) {
  await Log("backend", "debug", "service",
    `Looking up notification ID: ${id}`);

  const all = await getAllNotifications();
  const found = all.find((n) => n.ID === id);

  if (!found) {
    await Log("backend", "warn", "service",
      `Notification not found: ${id}`);
  }
  return found ?? null;
}

// ─── Public: mark one notification as read ────────────────────────────────────

async function markAsRead(id) {
  await Log("backend", "debug", "service",
    `Marking notification ${id} as read`);
  _readState.set(id, true);
  return true;
}

// ─── Public: mark all notifications as read ───────────────────────────────────

async function markAllAsRead() {
  await Log("backend", "info", "service",
    "Marking all cached notifications as read");

  const all = await _fetchFromServer();
  let count = 0;
  for (const n of all) {
    if (!_readState.get(n.ID)) {
      _readState.set(n.ID, true);
      count++;
    }
  }

  await Log("backend", "info", "service",
    `Marked ${count} notifications as read`);
  return count;
}

// ─── Min-Heap (no external libraries) ────────────────────────────────────────
// Stores { score, notification } objects; root is always the smallest score.
// Used to maintain top-N in O(log N) per insertion.

class MinHeap {
  constructor() { this._data = []; }

  get size()  { return this._data.length; }
  get min()   { return this._data[0] ?? null; }

  push(item) {
    this._data.push(item);
    this._bubbleUp(this._data.length - 1);
  }

  pop() {
    const top  = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._data[parent].score <= this._data[i].score) break;
      [this._data[parent], this._data[i]] = [this._data[i], this._data[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this._data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this._data[l].score < this._data[smallest].score) smallest = l;
      if (r < n && this._data[r].score < this._data[smallest].score) smallest = r;
      if (smallest === i) break;
      [this._data[smallest], this._data[i]] = [this._data[i], this._data[smallest]];
      i = smallest;
    }
  }

  // Drain all items in ascending score order
  drainAscending() {
    const out = [];
    while (this.size > 0) out.push(this.pop());
    return out;
  }
}

// ─── Priority score formula ───────────────────────────────────────────────────

function computeScore(notification) {
  const weight      = TYPE_WEIGHT[notification.Type] ?? 0;
  const timestampMs = new Date(notification.Timestamp).getTime();
  // Large multiplier so type always outranks any timestamp difference
  return weight * 1e12 + timestampMs;
}

// ─── Public: top-N priority notifications (Stage 6) ──────────────────────────

async function getTopNNotifications(n = 10) {
  await Log("backend", "debug", "service",
    `Computing top ${n} priority notifications`);

  const notifications = await getAllNotifications();

  const heap = new MinHeap();

  for (const notification of notifications) {
    // Skip notifications the student has already read
    // (In a real system "unread" would be the persistent DB field;
    //  here we use the in-memory _readState.)
    if (notification.isRead) continue;

    const score = computeScore(notification);
    const entry = { score, notification };

    if (heap.size < n) {
      heap.push(entry);
    } else if (heap.min && score > heap.min.score) {
      // Current notification beats the weakest item in our top-N
      heap.pop();
      heap.push(entry);
    }
  }

  // Extract and sort descending (highest priority first)
  const sorted = heap.drainAscending().reverse();

  await Log("backend", "info", "service",
    `Top ${n} computed. Highest: Type=${sorted[0]?.notification.Type ?? "none"}`);

  return sorted.map((entry) => ({
    ...entry.notification,
    priorityScore: entry.score,
  }));
}

module.exports = {
  getAllNotifications,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  getTopNNotifications,
};
