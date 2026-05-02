# Notification System Design

---

## Stage 1 – The API

This is a campus notification system for students. It sends alerts for **Placements, Events, and Results**.

Every request needs a login token in the header:
```
Authorization: Bearer <your_token>
```

### Endpoints

**Get all your notifications**
```
GET /api/notifications
```
Returns a list of all notifications for you. Add `?isRead=false` to see only unread ones.

**Get your top priority notifications**
```
GET /api/notifications/priority?n=10
```
Returns the N most important unread notifications (sorted by type + recency).

**Get one notification by ID**
```
GET /api/notifications/:id
```
Returns a single notification. Returns 404 if not found.

**Mark one notification as read**
```
PATCH /api/notifications/:id/read
```

**Mark all notifications as read**
```
PATCH /api/notifications/read-all
```

---

### Real-Time Notifications – Why SSE?

We use **Server-Sent Events (SSE)** to push notifications in real time:
```
GET /api/notifications/stream
```

**Why SSE and not WebSockets?**

| | SSE | WebSocket |
|---|---|---|
| Direction | Server → you only | Both ways |
| Setup | Simple HTTP | Needs special setup |
| Auto-reconnect | Yes, built in | You have to write it |
| Works through firewalls | Yes | Sometimes blocked |

Since notifications only flow **one way** (server → you), SSE is simpler and good enough.

**How it works:**
- You open a connection to the stream endpoint
- When a new notification comes in, the server pushes it to you instantly
- Redis Pub/Sub is used in the background to broadcast to all connected students

---

## Stage 2 – The Database

We use **PostgreSQL** because:
- It won't lose or duplicate data (ACID guarantees)
- It handles our exact data shape well
- It supports good indexing for fast lookups

### Tables

```sql
-- notification type can only be one of these three
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

CREATE TABLE students (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  email      VARCHAR(180) UNIQUE NOT NULL,
  roll_no    VARCHAR(30)  UNIQUE NOT NULL,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notification_type notification_type NOT NULL,
  message           TEXT NOT NULL,
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index to make "get my unread notifications" fast
CREATE INDEX idx_notif_student_unread_time
  ON notifications (student_id, is_read, created_at DESC);

-- Index to make "show all Placement notifications" fast
CREATE INDEX idx_notif_type_time
  ON notifications (notification_type, created_at DESC);
```

### What happens as the data grows?

| Problem | Why it happens | Fix |
|---|---|---|
| Slow reads | No index = full table scan | Add composite index (done above) |
| DB can't handle 50k inserts at once | Too many writes at the same time | Use bulk inserts + a message queue |
| One database gets overloaded | All traffic hits one server | Add read replicas |
| Old notifications pile up | Data never deleted | Partition table by month, archive old data |

---

## Stage 3 – Slow Query Fix

### Original query (the slow one)
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

This is **logically correct** but **slow without an index**. With 5 million rows and no index, the database checks every single row one by one.

### Fix 1 – Add an index
```sql
CREATE INDEX idx_notif_student_unread_time
  ON notifications (student_id, is_read, created_at DESC);
```
Now the database jumps straight to the right rows instead of scanning everything. Goes from O(n) → O(log n + k).

### Fix 2 – Don't use SELECT *
```sql
SELECT id, notification_type, message, is_read, created_at
FROM notifications
WHERE student_id = 1042 AND is_read = FALSE
ORDER BY created_at DESC;
```
Only fetch the columns you actually need — less data to move around.

### Should you index every column?

**No.** Every index:
- Slows down inserts, updates, and deletes (every write updates all indexes)
- Takes up extra disk space
- Can confuse the query planner

Only index columns used in `WHERE`, `ORDER BY`, or `JOIN` in your most common queries.

### Find students who got a Placement notification in the last 7 days
```sql
SELECT DISTINCT s.id, s.name, s.email, s.roll_no
FROM students s
JOIN notifications n ON n.student_id = s.id
WHERE n.notification_type = 'Placement'
  AND n.created_at >= NOW() - INTERVAL '7 days'
ORDER BY s.id;
```

---

## Stage 4 – Caching (Stop hitting the DB on every page load)

**The problem:** Every time a student opens the app, it runs a DB query. With thousands of students, this hammers the database for data that barely changes.

### Option 1 – Redis Cache (Best fix)
Store the notification list in Redis for 30–60 seconds.

- Key: `notifications:{studentID}:all`
- When a student marks something as read, delete that key so it refreshes
- Pro: DB barely touched during peak hours
- Con: Up to 30s delay for new notifications to show

### Option 2 – SSE Push (Best for long-term)
Don't fetch on page load at all — just listen on the SSE stream. New notifications arrive automatically.
- Pro: No repeated DB queries, instant delivery
- Con: More complex, needs persistent connections

### Option 3 – HTTP Cache Headers (Simple but limited)
Server sends `ETag` header. Browser sends it back next time. Server replies `304 Not Modified` if nothing changed — saves bandwidth but still a round-trip.

### Option 4 – Unread Count Badge (Lightweight)
Only fetch the count on load, not the full list:
```
GET /api/notifications/unread-count → { "count": 5 }
```
Only load the full list when the student actually opens the notification panel.

### Best combo: Redis + SSE
- Redis serves the first load fast (< 1ms)
- SSE keeps the client updated in real time
- DB only queried on cache miss

---

## Stage 5 – Sending Notifications to 50,000 Students

### The original broken approach
```python
function notify_all(student_ids, message):
    for student_id in student_ids:
        send_email(student_id, message)   # email API call
        save_to_db(student_id, message)   # DB insert
        push_to_app(student_id, message)  # real-time push
```

**What's wrong with this?**
1. **Way too slow** – 50,000 students × 10ms each = ~8 minutes. Last students wait forever.
2. **No error recovery** – if it crashes at student 30,000, the rest are silently skipped.
3. **DB gets hammered** – 50,000 individual inserts one by one is very slow.
4. **No retry** – if an email fails, it's just gone.
5. **If you restart it**, students already emailed get emailed again.

### The fixed approach

```python
function notify_all(student_ids, message):

    # Step 1: Insert ALL records into DB in ONE bulk query (fast + atomic)
    records = [{ student_id: id, message: message, status: "pending" } for id in student_ids]
    bulk_insert_notifications(records)

    # Step 2: Add email jobs to a queue (non-blocking, just scheduling)
    for student_id in student_ids:
        enqueue({ type: "send_email", student_id: student_id, message: message, retries: 0 })

    # Step 3: Push via Redis → SSE to all connected students instantly
    publish_to_redis("notifications:broadcast", { message, student_ids })

    return { queued: len(student_ids), status: "processing" }


# Worker runs separately and processes the email queue
function email_worker(job):
    success = send_email(job.student_id, job.message)

    if success:
        update_notification_status(job.student_id, "sent")
    elif job.retries < 3:
        requeue_after(job, delay=exponential_backoff(job.retries))  # retry: 1s, 4s, 16s
    else:
        mark_as_failed(job.student_id)
        alert_ops_team(job.student_id)  # dead-letter queue
```

### Should DB save and email send be in the same transaction?

**No.** Keep them separate:
- The DB insert is fast and under our control → commit it immediately
- The email API is slow and can fail → handle it separately with retries
- If they're combined and the email API hangs, the DB transaction is stuck open and then rolls back — the student has no record at all


---

## Stage 6 – Priority Inbox (Top-N without sorting everything)

### How priority score is calculated

```
score = typeWeight × 10¹² + timestampMilliseconds
```

| Type | Weight |
|---|---|
| Placement | 3 |
| Result | 2 |
| Event | 1 |

The `× 10¹²` ensures a Placement from last year always beats an Event from 1 second ago. Within the same type, newer = higher score.

### Why a Min-Heap instead of sorting?

| Approach | Time | Space |
|---|---|---|
| Sort everything, take top N | O(n log n) | O(n) |
| Min-Heap of size N | **O(n log N)** | **O(N)** |

With N=10 and 5 million notifications, the heap does ~7× fewer comparisons.

### How the heap works (plain English)

1. Keep a heap of exactly N items. The weakest item sits at the top (min-heap).
2. For each notification, compute its score.
3. If heap has fewer than N items → add it.
4. Else if new score > top of heap → kick the top out, add the new one.
5. At the end, drain the heap to get top-N in order.

### When a new notification arrives live

1. Compute its score → O(1)
2. Compare with heap top → O(1)
3. If it qualifies, swap it in → O(log N)

The top-N list stays fresh without reprocessing all history. This is implemented in `notificationService.js` using a custom `MinHeap` class (no external libraries).

**API:**
```
GET /api/notifications/priority?n=10
```