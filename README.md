# Campus Backend Platform

Backend track submission covering:
- **Logging Middleware** — reusable `Log(stack, level, package, message)` package
- **Vehicle Maintence Scheduler** — 0/1 Knapsack microservice
- **Campus Notifications** — REST API (Stages 1–6) with Priority Inbox

---

## Repository Structure

```
.
├── .gitignore
├── .env.example                        ← copy to .env and fill credentials
├── notification_system_design.md       ← Stages 1–6 design document
│
├── logging_middleware/
│   ├── index.js                        ← reusable Log() function
│   └── package.json
│
├── vehicle_maintence_scheduler/
│   ├── index.js                        ← entry point (run with node index.js)
│   ├── scheduler.js                    ← 0/1 Knapsack DP algorithm
│   └── package.json
│
└── notification_app_be/
    ├── package.json
    └── src/
        ├── app.js                      ← Express entry point
        ├── middleware/
        │   └── authMiddleware.js
        ├── routes/
        │   └── notificationRoutes.js
        ├── controllers/
        │   └── notificationController.js
        └── services/
            └── notificationService.js  ← MinHeap Priority Inbox (Stage 6)
```

---

## Prerequisites

- **Node.js** v18 or later (uses native `fetch`)
- **npm** v8 or later

---

## Setup (one-time)

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/<repo-name>.git
cd <repo-name>
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in the credentials you received on registration:

```env
AUTH_EMAIL=your@college.edu
AUTH_NAME=Your Name
AUTH_ROLLNO=yourrollno
AUTH_ACCESS_CODE=yourAccessCode
AUTH_CLIENT_ID=your-client-id
AUTH_CLIENT_SECRET=your-client-secret
PORT=3000
```

### 3. Install dependencies for each module

```bash
# Logging middleware
cd logging_middleware && npm install && cd ..

# Vehicle scheduler
cd vehicle_maintence_scheduler && npm install && cd ..

# Notification backend
cd notification_app_be && npm install && cd ..
```

---

## Running the projects

### Vehicle Maintenance Scheduler

```bash
cd vehicle_maintence_scheduler
node index.js
```

Expected output — the scheduler fetches depots and vehicles from the test server,
runs the 0/1 Knapsack algorithm for each depot, and prints the schedule:

```
========== VEHICLE MAINTENANCE SCHEDULE ==========

────────────────────────────────────────────────────────────
  Depot 1  |  Budget: 60h  |  Used: 58h  |  Impact: 143
────────────────────────────────────────────────────────────
  Tasks selected (N):
    01. <TaskID>  |  6h  |  score 10
    ...
```

### Notification Backend (REST API)

```bash
cd notification_app_be
npm start
# Server running on http://localhost:3000
```

#### Available endpoints (test with Postman / Insomnia)

| Method | URL | Description |
|--------|-----|-------------|
| `GET`  | `/health` | Health check |
| `GET`  | `/api/notifications` | All notifications |
| `GET`  | `/api/notifications?isRead=false` | Unread only |
| `GET`  | `/api/notifications/priority?n=10` | Top-10 priority inbox |
| `GET`  | `/api/notifications/:id` | Single notification |
| `PATCH`| `/api/notifications/:id/read` | Mark one as read |
| `PATCH`| `/api/notifications/read-all` | Mark all as read |

> **No Authorization header is required on your local app** — the backend
> internally uses your `.env` credentials to call the test server.
> Capture Postman/Insomnia screenshots of calls to `http://localhost:3000`.

---

## Notes

- The `.env` file is **git-ignored** — never commit credentials.
- The `logging_middleware` is consumed by both other modules via a relative
  `require("../logging_middleware/index.js")` path — keep the folder structure intact.
- `notification_system_design.md` contains the full written response to Stages 1–6.
