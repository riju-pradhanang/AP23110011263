/**
 * 0/1 Knapsack implementation
 *
 * Approach: Space-optimised 1-D dynamic-programming.
 *
 *   dp[w] = maximum Impact achievable using exactly w mechanic-hours.
 *
 *   For each task i (weight = Duration, value = Impact):
 *     Traverse dp[] from W down to Duration   ← prevents reuse (0/1 constraint)
 *     dp[w] = max(dp[w], dp[w - Duration] + Impact)
 *
 * Time  : O(n × W)  where n = number of tasks, W = mechanic-hour budget
 * Space : O(W)      — only one 1-D array
 *
 *
 * @module scheduler
 */

"use strict";

/**
 * Solve the 0/1 Knapsack problem.
 *
 * @param {Array<{TaskID: string, Duration: number, Impact: number}>} tasks
 * @param {number} capacity  - available mechanic-hours (budget)
 * @returns {{ selectedTasks: Array, totalImpact: number }}
 */
function solveKnapsack(tasks, capacity) {
  const n = tasks.length;

  if (n === 0 || capacity <= 0) {
    return { selectedTasks: [], totalImpact: 0 };
  }

  // ── Build DP table ────────────────────────────────────────────────────────
  // dp[w] = best Impact achievable with at most w hours
  const dp = new Array(capacity + 1).fill(0);

  for (let i = 0; i < n; i++) {
    const { Duration: w, Impact: v } = tasks[i];

    // Skip tasks that can never fit (Duration > entire budget)
    if (w > capacity) continue;

    // Traverse backwards to keep 0/1 property (each item used at most once)
    for (let cap = capacity; cap >= w; cap--) {
      const candidate = dp[cap - w] + v;
      if (candidate > dp[cap]) {
        dp[cap] = candidate;
      }
    }
  }

  const totalImpact = dp[capacity];

  // ── Backtrack to find which tasks were chosen ─────────────────────────────
  // Walk the task list in reverse; a task was chosen if removing it reduces
  // the best achievable impact at the current remaining capacity.
  const selectedTasks = [];
  let remaining = capacity;

  for (let i = n - 1; i >= 0 && remaining > 0; i--) {
    const { Duration: w, Impact: v } = tasks[i];

    if (
      remaining >= w &&
      dp[remaining] === dp[remaining - w] + v
    ) {
      selectedTasks.push(tasks[i]);
      remaining -= w;
    }
  }

  return { selectedTasks, totalImpact };
}

module.exports = { solveKnapsack };
