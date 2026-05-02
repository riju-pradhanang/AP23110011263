
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });

const { Log } = require("../../../logging_middleware/index.js");

const TEST_SERVER_BASE = "http://20.207.122.201/evaluation-service";

const TYPE_WEIGHT = { Placement: 3, Result: 2, Event: 1 };


const _readState = new Map();

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

//Raw fetch from test server

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


async function getAllNotifications() {
  const raw = await _fetchFromServer();

  return raw.map((n) => ({
    ...n,
    isRead: _readState.get(n.ID) ?? false,
  }));
}


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


async function markAsRead(id) {
  await Log("backend", "debug", "service",
    `Marking notification ${id} as read`);
  _readState.set(id, true);
  return true;
}


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


function computeScore(notification) {
  const weight      = TYPE_WEIGHT[notification.Type] ?? 0;
  const timestampMs = new Date(notification.Timestamp).getTime();
  return weight * 1e12 + timestampMs;
}


async function getTopNNotifications(n = 10) {
  await Log("backend", "debug", "service",
    `Computing top ${n} priority notifications`);

  const notifications = await getAllNotifications();

  const heap = new MinHeap();

  for (const notification of notifications) {
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
