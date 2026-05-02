/**
 * Vehicle Maintenance Scheduler — entry point.
 *
 * Problem statement (from spec):
 *   Given a list of vehicles each with a Duration (hours) and Impact (score),
 *   and a per-depot MechanicHours budget, pick the subset of tasks that
 *   MAXIMISES total Impact without exceeding the budget.
 *   This is the classic 0/1 Knapsack problem.
 *
 * Algorithm: Space-optimised 1-D DP (bottom-up), O(n × W) time, O(W) space.
 *
 */

"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { Log } = require("../logging_middleware/index.js");
const { solveKnapsack } = require("./scheduler.js");

const TEST_SERVER_BASE = "http://20.207.122.201/evaluation-service";

// Helper: truncate a string to at most 48 chars for safe logging
function truncate(str, max = 48) {
  return str.length <= max ? str : str.substring(0, max - 1) + "…";
}

// ─── Auth ────────────────────────────────────────────────────────────────────

async function getAuthToken() {
  const payload = {
    email:        process.env.AUTH_EMAIL,
    name:         process.env.AUTH_NAME,
    rollNo:       process.env.AUTH_ROLLNO,
    accessCode:   process.env.AUTH_ACCESS_CODE,
    clientID:     process.env.AUTH_CLIENT_ID,
    clientSecret: process.env.AUTH_CLIENT_SECRET,
  };

  // FIX
  await Log("backend", "debug", "auth",
    truncate(`Auth token request: ${payload.email}`));

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
  // FIX: "Bearer token obtained successfully" (34 chars) — kept consistent
  await Log("backend", "info", "auth", "Bearer token obtained");
  return data.access_token;
}

// ─── Data fetching ───────────────────────────────────────────────────────────

async function fetchDepots(token) {
  // FIX: "Fetching depot list from test server" (36 chars) — trimmed anyway
  await Log("backend", "info", "service", "Fetching depot list from server");

  const res = await fetch(`${TEST_SERVER_BASE}/depots`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    // FIX: `Depot API error: status ${res.status}` (37 chars) — ok
    await Log("backend", "error", "service",
      `Depot API error: ${res.status}`);
    throw new Error(`Depot API error: ${res.status}`);
  }

  const data = await res.json();
  // FIX: "Fetched ${data.depots.length} depots from test server" (53 chars) — TOO LONG
  await Log("backend", "info", "service",
    `Fetched ${data.depots.length} depots`);
  return data.depots; // [{ ID, MechanicHours }]
}

async function fetchVehicles(token) {
  // FIX: trimmed
  await Log("backend", "info", "service", "Fetching vehicle task list");

  const res = await fetch(`${TEST_SERVER_BASE}/vehicles`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    // FIX: trimmed
    await Log("backend", "error", "service",
      `Vehicles API error: ${res.status}`);
    throw new Error(`Vehicles API error: ${res.status}`);
  }

  const data = await res.json();
  // FIX: "Fetched ${data.vehicles.length} vehicle tasks from test server" (62 chars) — TOO LONG
  await Log("backend", "info", "service",
    `Fetched ${data.vehicles.length} vehicles`);
  return data.vehicles; // [{ TaskID, Duration, Impact }]
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function printResult(result) {
  const sep = "─".repeat(60);
  console.log(`\n${sep}`);
  console.log(
    `  Depot ${result.depotID}  |  Budget: ${result.budget}h  |  Used: ${result.hoursUsed}h  |  Impact: ${result.totalImpact}`
  );
  console.log(`${sep}`);
  console.log(`  Tasks selected (${result.tasks.length}):`);
  result.tasks.forEach((t, i) => {
    console.log(
      `    ${String(i + 1).padStart(2, "0")}. ${t.TaskID}  |  ${t.Duration}h  |  score ${t.Impact}`
    );
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // FIX: "Vehicle Maintenance Scheduler starting up" (41 chars) — OK but trimmed
  await Log("backend", "info", "controller", "Scheduler starting up");

  // 1. Authenticate
  let token;
  try {
    token = await getAuthToken();
  } catch (err) {
    // FIX: was `Authentication failed — cannot proceed: ${err.message}` (54+ chars) — TOO LONG
    await Log("backend", "fatal", "auth",
      truncate(`Auth failed: ${err.message}`));
    console.error("FATAL:", err.message);
    process.exit(1);
  }

  // 2. Fetch depots and vehicles in parallel
  let depots, vehicles;
  try {
    [depots, vehicles] = await Promise.all([
      fetchDepots(token),
      fetchVehicles(token),
    ]);
  } catch (err) {
    // FIX
    await Log("backend", "fatal", "service",
      truncate(`Data fetch failed: ${err.message}`));
    console.error("FATAL:", err.message);
    process.exit(1);
  }

  await Log("backend", "info", "domain",
    `Scheduler: ${depots.length} depots, ${vehicles.length} tasks`);

  // 3. Run 0/1 Knapsack for each depot
  const results = [];
  for (const depot of depots) {
    const { ID, MechanicHours } = depot;

    await Log("backend", "debug", "domain",
      `Depot ${ID}: budget ${MechanicHours}h, tasks ${vehicles.length}`);

    const { selectedTasks, totalImpact } = solveKnapsack(vehicles, MechanicHours);
    const hoursUsed = selectedTasks.reduce((s, t) => s + t.Duration, 0);

    results.push({
      depotID:     ID,
      budget:      MechanicHours,
      hoursUsed,
      totalImpact,
      tasks:       selectedTasks,
    });

    // FIX: was multi-part template that exceeded 48 chars — split key info, truncate
    await Log("backend", "info", "domain",
      `Depot ${ID}: ${selectedTasks.length} tasks, impact=${totalImpact}`);
  }

  // 4. Print summary
  console.log("\n========== VEHICLE MAINTENANCE SCHEDULE ==========");
  for (const r of results) {
    printResult(r);
  }

  console.log("\n");
  // FIX: was "Vehicle Maintenance Scheduler completed successfully" (52 chars) — TOO LONG
  await Log("backend", "info", "controller", "Scheduler completed");
}

main().catch(async (err) => {
  // FIX: was `Unhandled top-level error: ${err.message}` — err.message can be long
  await Log("backend", "fatal", "controller",
    truncate(`Unhandled error: ${err.message}`));
  console.error("Unhandled error:", err);
  process.exit(1);
});