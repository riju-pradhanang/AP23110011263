# Notification System Design

---

## Stage 1

### Overview

The campus notification platform delivers real-time updates to students for three categories: **Placements**, **Events**, and **Results**. The API is designed RESTfully with consistent naming, clear JSON schemas, and a real-time push mechanism.

---

### Core REST API Endpoints

All endpoints require:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

---

#### 1. Get all notifications for the authenticated student

```
GET /api/notifications
Authorization: Bearer <token>

Query params (optional):
  isRead=true|false    — filter by read state

Response 200:
{
  "count": 15,
  "notifications": [
    {
      "ID":        "uuid-v4",
      "Type":      "Placement" | "Result" | "Event",
      "Message":   "CSX Corporation hiring",
      "Timestamp": "2026-04-22T17:51:18Z",
      "isRead":    false
    }
  ]
}
```

---

#### 2. Get priority inbox (top-N most important unread notifications)

```
GET /api/notifications/priority?n=10
Authorization: Bearer <token>

Response 200:
{
  "count": 10,
  "notifications": [
    {
      "ID":            "uuid-v4",
      "Type":          "Placement",
      "Message":       "CSX Corporation hiring",
      "Timestamp":     "2026-04-22T17:51:18Z",
      "isRead":        false,
      "priorityScore": 3000001745340678
    }
  ]
}
```

---

#### 3. Get a single notification by ID

```
GET /api/notifications/:id
Authorization: Bearer <token>

Response 200:
{
  "notification": {
    "ID":        "uuid-v4",
    "Type":      "Result",
    "Message":   "mid-sem",
    "Timestamp": "2026-04-22T17:51:30Z",
    "isRead":    false
  }
}

Response 404:
{ "error": "Not found", "message": "Notification <id> does not exist" }
```

---

#### 4. Mark a single notification as read

```
PATCH /api/notifications/:id/read
Authorization: Bearer <token>

Response 200:
{ "message": "Notification marked as read", "id": "uuid-v4" }
```

---

#### 5. Mark all notifications as read

```
PATCH /api/notifications/read-all
Authorization: Bearer <token>

Response 200:
{ "message": "Marked 42 notifications as read", "markedCount": 42 }
```

---

### Real-Time Notification Mechanism

**Chosen approach: Server-Sent Events (SSE)**

```
GET /api/notifications/stream
Authorization: Bearer <token>
Accept: text/event-stream

Server pushes:
data: {"ID":"uuid","Type":"Placement","Message":"TCS hiring","Timestamp":"2026-05-01T10:00:00Z"}
```

**Why SSE over WebSockets?**

| Criterion | SSE | WebSocket |
|-----------|-----|-----------|
| Direction | Server → Client (unidirectional) | Bidirectional |
| Protocol | HTTP/1.1 (no upgrade needed) | ws:// |
| Browser reconnect | Built-in auto-reconnect | Must implement manually |
| Proxy/firewall | Works through standard HTTP proxies | May be blocked |
| Complexity | Simple — `res.write()` | Needs ws library, connection state |

Notifications are push-only from server to client; SSE is the right fit. The client never needs to send data back on the stream.

**Architecture:**
```
Student browser ──SSE──► Notification Service ──Redis Pub/Sub──► Worker
                                                                     │
                                                               Test Server
                                                                (source of truth)
```

Each connected student holds an open SSE connection. When a new notification is published (e.g., HR triggers "Notify All"), a message is published to Redis channel `notifications:<studentID>`, and each active SSE handler writes the event to the student's response stream.

---

## Stage 2

### Recommended Database: PostgreSQL

**Rationale:**
- Strong ACID guarantees — notifications must not be lost or duplicated.
- Native `ENUM` type maps directly to `notification_type` values.
- Partial indexes and composite indexes give excellent read performance on the notification access pattern (filter by student + unread + timestamp).
- JSONB column available for future extensibility (e.g., metadata, deep-links).
- Wide ecosystem, battle-tested at scale with logical replication and read replicas.

---

### Schema

```sql
-- Enum for notification category
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

-- Students table
CREATE TABLE students (
  id         SERIAL        PRIMARY KEY,
  name       VARCHAR(120)  NOT NULL,
  email      VARCHAR(180)  UNIQUE NOT NULL,
  roll_no    VARCHAR(30)   UNIQUE NOT NULL,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
  id                  UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          INTEGER          NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notification_type   notification_type NOT NULL,
  message             TEXT             NOT NULL,
  is_read             BOOLEAN          NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- Primary access pattern: fetch unread notifications for a student, newest first
-- Composite index covering student_id + is_read + created_at DESC
CREATE INDEX idx_notif_student_unread_time
  ON notifications (student_id, is_read, created_at DESC);

-- For placement-specific queries (Stage 3 query)
CREATE INDEX idx_notif_type_time
  ON notifications (notification_type, created_at DESC);
```

---

### Scaling Problems as Data Grows

| Problem | Cause | Solution |
|---------|-------|---------|
| Slow reads | Full table scan across 5 M+ rows | Composite indexes (already added above) |
| Write bottleneck | 50k simultaneous INSERTs on "Notify All" | Batch inserts; message queue (Stage 5) |
| Single-node limit | One PostgreSQL instance | Read replicas for read traffic; primary for writes |
| Old notification bloat | Notifications accumulate forever | Partition table by `created_at` (monthly); archive old partitions |
| Cold cache on start | Buffer pool empty after restart | Pre-warm cache; use Redis for hot notification counts |

**Table partitioning** (when rows exceed ~10 M):
```sql
-- Range partition by month
CREATE TABLE notifications (
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE notifications_2026_04
  PARTITION OF notifications
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

---

### Queries Mapped to REST API Endpoints

```sql
-- GET /api/notifications  (all notifications for a student)
SELECT id, notification_type, message, is_read, created_at
FROM   notifications
WHERE  student_id = $1
ORDER  BY created_at DESC;

-- GET /api/notifications?isRead=false  (unread only)
SELECT id, notification_type, message, created_at
FROM   notifications
WHERE  student_id = $1 AND is_read = FALSE
ORDER  BY created_at DESC;

-- GET /api/notifications/:id
SELECT id, notification_type, message, is_read, created_at
FROM   notifications
WHERE  id = $1;

-- PATCH /api/notifications/:id/read
UPDATE notifications
SET    is_read = TRUE
WHERE  id = $1;

-- PATCH /api/notifications/read-all
UPDATE notifications
SET    is_read = TRUE
WHERE  student_id = $1 AND is_read = FALSE;
```

---

## Stage 3

### Is the original query accurate?

```sql
SELECT * FROM notifications
WHERE  studentID = 1042 AND isRead = false
ORDER  BY createdAt DESC;
```

**Yes, it is logically correct** — it retrieves all unread notifications for student 1042, newest first.

---

### Why is it slow?

With 50,000 students and 5,000,000 notifications and **no composite index** on `(studentID, isRead, createdAt)`, PostgreSQL performs a **sequential scan** of the entire `notifications` table, evaluating every row against the WHERE clause before sorting. This is O(n) in the number of rows.

Additional cost drivers:
- `SELECT *` fetches every column including potentially wide `message` TEXT fields, increasing I/O.
- `ORDER BY createdAt DESC` requires a sort step on the already-filtered result set if there is no index to provide pre-sorted output.

---

### What to change and likely computation cost

**Fix 1 — Add a composite covering index:**

```sql
CREATE INDEX idx_notif_student_unread_time
  ON notifications (student_id, is_read, created_at DESC);
```

With this index, PostgreSQL uses an **Index Scan** (or **Index Only Scan** if all needed columns are in the index), reducing the cost from O(n) sequential scan to O(log n + k) where k = number of unread notifications for that student. For a student with 100 unread notifications out of 5 M total rows, this is an enormous speedup.

**Fix 2 — Replace `SELECT *` with specific columns:**

```sql
SELECT id, notification_type, message, is_read, created_at
FROM   notifications
WHERE  student_id = 1042 AND is_read = FALSE
ORDER  BY created_at DESC;
```

This reduces row width transferred from storage, making each page fetch more efficient.

**Computation cost after fix:** O(log N + k) — logarithmic index lookup + linear scan of only the matching rows.

---

### Is indexing every column a good idea?

**No — this is bad advice.**

Every index has costs:
1. **Write amplification** — every `INSERT`, `UPDATE`, `DELETE` must also update all indexes. With 10 indexes, a single row write becomes 10 B-tree updates.
2. **Storage overhead** — each index is a separate data structure on disk, often comparable in size to the table itself.
3. **Query planner confusion** — the planner may choose a suboptimal index or spend more time evaluating many possible query plans.
4. **Maintenance cost** — `VACUUM` and `ANALYZE` must process all indexes.

**Index only the columns that appear in WHERE, JOIN, and ORDER BY clauses of your most frequent, most expensive queries.**

---

### Query: students with a Placement notification in the last 7 days

```sql
SELECT DISTINCT s.id, s.name, s.email, s.roll_no
FROM   students       s
JOIN   notifications  n ON n.student_id = s.id
WHERE  n.notification_type = 'Placement'
  AND  n.created_at >= NOW() - INTERVAL '7 days'
ORDER  BY s.id;
```

Supported by `idx_notif_type_time` on `(notification_type, created_at DESC)`.

---

## Stage 4

### Problem

Fetching the full notification list from the database on **every page load** for every student causes:
- Repeated identical queries for data that rarely changes between requests.
- Database CPU and I/O saturation during peak hours.
- High read latency propagating to poor user experience.

---

### Solutions and Tradeoffs

#### Strategy 1 — Redis cache with TTL (recommended primary fix)

Cache the notification list per student in Redis with a short TTL (e.g., 30–60 seconds).

```
Cache key  : notifications:{studentID}:all
TTL        : 30 seconds
Invalidate : on markAsRead / markAllAsRead for that studentID
```

**Pros:** Eliminates DB hits for the majority of page loads. Sub-millisecond reads from Redis.  
**Cons:** Up to 30-second staleness for new notifications. Requires Redis infrastructure. Cache invalidation logic must be maintained.

---

#### Strategy 2 — Push, not Poll (SSE / WebSocket)

Instead of fetching on page load, the client subscribes to a real-time stream. The server pushes new notifications as they arrive. The client **never needs to poll**.

**Pros:** No redundant DB queries. Instant notification delivery. Drastically reduced server load.  
**Cons:** Persistent connections consume server memory (mitigated by horizontal scaling + Redis Pub/Sub). Requires SSE/WebSocket infrastructure. More complex than REST polling.

---

#### Strategy 3 — HTTP Cache Headers (ETag / Last-Modified)

The server returns `ETag` and `Last-Modified` headers. The client sends `If-None-Match` on subsequent requests; the server responds `304 Not Modified` if nothing changed.

**Pros:** Simple to implement. No extra infrastructure. Saves bandwidth.  
**Cons:** Still requires a round-trip to the server on every load (just cheaper). Does not reduce DB load unless the server can determine staleness without a DB query (e.g., Redis-backed last-modified timestamp).

---

#### Strategy 4 — Unread count endpoint + lazy-load

Instead of fetching all notifications on page load, expose a lightweight endpoint:
```
GET /api/notifications/unread-count → { "count": 5 }
```
The client shows a badge. Only when the student opens the notification panel does it fetch the full list.

**Pros:** Minimal payload on page load. Works without caching infrastructure.  
**Cons:** Still hits DB for the count query (though this is much cheaper). Full list fetch still needed when panel is opened.

---

#### Recommended combination

**Redis cache (Strategy 1) + SSE push (Strategy 2):**
- Redis handles the initial page-load read (cache warm hit in < 1 ms).
- SSE pushes new notifications in real time, updating the client's in-memory state.
- The DB is only queried when cache misses occur (first load, post-TTL) or when a push event triggers targeted invalidation.

---

## Stage 5

### Shortcomings of the original implementation

```python
function notify_all(student_ids: array, message: string):
    for student_id in student_ids:
        send_email(student_id, message)   # calls Email API
        save_to_db(student_id, message)   # DB insert
        push_to_app(student_id, message)  # real-time push
```

1. **Sequential loop** — 50,000 iterations run one-by-one. With even 10 ms per iteration, this takes 500 seconds (~8 minutes). Students notified last wait the longest.
2. **No atomicity** — if `send_email` succeeds but `save_to_db` fails, the student received an email but has no record in the system (ghost notification).
3. **No retry logic** — if `send_email` fails for student 30,000 midway, the loop may abort. Those 200+ students are silently skipped with no record of the failure.
4. **DB overload** — 50,000 individual `INSERT` statements in rapid succession hammer the database. Bulk inserts are orders of magnitude faster.
5. **No idempotency** — if the process crashes and is restarted, students already notified may be notified again.
6. **Tight coupling** — DB save and email send are interleaved in the same transaction context with no separation of concerns.

---

### When send_email failed for 200 students midway

Without retry logic or a dead-letter queue, those 200 students are permanently missed. There is no record of which students failed, making manual remediation impossible.

---

### Redesigned approach

**Core principle:** The database insert is the **source of truth** and must happen first, independently. Email delivery is an **external side effect** handled asynchronously via a message queue with retry semantics.

```python
function notify_all(student_ids: array, message: string):

    # ── Step 1: Bulk insert all notifications into DB atomically ──────────
    # Single INSERT ... VALUES (...), (...), ... in one transaction.
    # Fast, atomic, and idempotent (use ON CONFLICT DO NOTHING with a
    # unique constraint on (student_id, message_hash, sent_at_day)).
    records = [
        { student_id: id, message: message, status: "pending", created_at: now() }
        for id in student_ids
    ]
    bulk_insert_notifications(records)  # single DB transaction, O(1) round-trip

    # ── Step 2: Enqueue email jobs (non-blocking) ─────────────────────────
    # Publishing to a queue (e.g., RabbitMQ, BullMQ, AWS SQS) is fast and
    # decoupled from actual delivery.
    for student_id in student_ids:
        enqueue({ type: "send_email", student_id: student_id, message: message, retries: 0 })

    # ── Step 3: Push in-app notification via SSE/WebSocket ────────────────
    # Publish to Redis Pub/Sub; connected SSE handlers deliver to live students.
    publish_to_redis("notifications:broadcast", { message: message, student_ids: student_ids })

    return { queued: len(student_ids), status: "processing" }


# ── Worker (runs separately, processes queue) ─────────────────────────────────
function email_worker(job):
    success = send_email(job.student_id, job.message)

    if success:
        update_notification_status(job.student_id, job.message, "sent")

    elif job.retries < MAX_RETRIES:          # e.g. MAX_RETRIES = 3
        delay = exponential_backoff(job.retries)
        requeue_after(job, delay)            # retry with back-off (e.g., 1s, 4s, 16s)

    else:
        update_notification_status(job.student_id, job.message, "failed")
        alert_ops_team(job.student_id)       # page on-call, write to dead-letter queue
```

---

### Should DB save and email send happen in the same transaction?

**No.** They must be separated.

- The DB insert is fast, local, and fully under our control. It should commit immediately.
- The email send is a slow, external API call subject to network failures, rate limits, and third-party outages. Coupling it to the DB transaction means: if the email API is slow or fails, the DB transaction is held open (blocking locks) and then rolled back — the student gets no record at all.
- By separating them: the DB record is permanent and correct regardless of email delivery status. Email delivery becomes an eventually-consistent side effect with its own retry loop and audit trail.

**The DB is the ledger. The queue is the delivery pipe.**

---

## Stage 6

### Approach: Min-Heap for Efficient Top-N Priority Inbox

#### Priority Score Formula

```
score = typeWeight × 10¹² + timestampMilliseconds
```

| Notification Type | Weight |
|-------------------|--------|
| Placement         | 3      |
| Result            | 2      |
| Event             | 1      |

The multiplier `10¹²` ensures that a Placement notification from last year always outranks an Event from one second ago. Within the same type, recency (higher timestamp = higher score) breaks ties.

---

#### Algorithm: Min-Heap of size N

**Why a heap and not a full sort?**

| Approach | Time Complexity | Space |
|----------|----------------|-------|
| Sort all, take first N | O(n log n) | O(n) |
| Min-Heap of size N | **O(n log N)** | **O(N)** |

When N=10 and n=5,000,000, `log N ≈ 3.32` vs `log n ≈ 22.5` — the heap is ~7× fewer comparisons per notification.

**How it works:**
1. Maintain a min-heap of exactly N items (the root is always the weakest item in our current top-N).
2. For each incoming notification, compute its score.
3. If the heap has fewer than N items → push unconditionally.
4. Else if the notification's score > heap root's score → pop the root, push the new notification.
5. At the end, drain the heap in descending order → top-N list.

---

#### Handling continuous new notifications (streaming)

When a new notification arrives via SSE/WebSocket push:
1. Compute its score in O(1).
2. Compare against the heap root in O(1).
3. If it qualifies, perform heap pop + push in O(log N).

The top-N list is always current without reprocessing the full history. This is the key advantage of the heap structure for a live notification feed.

**Implementation:** See `notification_app_be/src/services/notificationService.js` — the `MinHeap` class and `getTopNNotifications(n)` function implement this approach without any external libraries.

**API endpoint:**
```
GET /api/notifications/priority?n=10
Authorization: Bearer <token>
```
