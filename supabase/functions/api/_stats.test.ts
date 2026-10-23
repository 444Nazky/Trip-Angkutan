import { recordRequest, statsSnapshot } from "./_stats.ts";

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: ${actual} !== ${expected}`);
}

Deno.test("statsSnapshot menghitung total, success rate, latensi, dan endpoint teratas", () => {
  recordRequest("/a", 200, 10);
  recordRequest("/a", 404, 20);
  recordRequest("/b", 500, 30);

  const s = statsSnapshot("test-instance");

  eq(s.requests.total, 3, "total");
  eq(s.requests.ok, 1, "ok");
  eq(s.requests.clientErrors, 1, "clientErrors");
  eq(s.requests.serverErrors, 1, "serverErrors");
  eq(s.requests.successRate, 33.3, "successRate");
  eq(s.requests.avgMs, 20, "avgMs");
  eq(s.requests.rpm, 3, "rpm");
  eq(s.requests.recentAvgMs, 20, "recentAvgMs");
  eq(s.requests.total, s.requests.ok + s.requests.clientErrors + s.requests.serverErrors, "konsisten");

  eq(s.topEndpoints[0].path, "/a", "top path");
  eq(s.topEndpoints[0].count, 2, "top count");
  eq(s.topEndpoints[0].errors, 1, "top errors");
  eq(s.topEndpoints[0].avgMs, 15, "top avgMs");

  eq(s.instance, "test-instance", "instance");
  eq(typeof s.uptimeSeconds, "number", "uptime");
});
