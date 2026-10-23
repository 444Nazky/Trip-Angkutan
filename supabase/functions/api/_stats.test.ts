import { assertEquals } from "jsr:@std/assert@1";
import { recordRequest, statsSnapshot } from "./_stats.ts";

Deno.test("statsSnapshot menghitung total, success rate, latensi, dan endpoint teratas", () => {
  recordRequest("/a", 200, 10);
  recordRequest("/a", 404, 20);
  recordRequest("/b", 500, 30);

  const s = statsSnapshot("test-instance");

  assertEquals(s.requests.total, 3);
  assertEquals(s.requests.ok, 1);
  assertEquals(s.requests.clientErrors, 1);
  assertEquals(s.requests.serverErrors, 1);
  assertEquals(s.requests.successRate, 33.3);
  assertEquals(s.requests.avgMs, 20);
  assertEquals(s.requests.rpm, 3);
  assertEquals(s.requests.recentAvgMs, 20);
  assertEquals(s.requests.total, s.requests.ok + s.requests.clientErrors + s.requests.serverErrors);

  assertEquals(s.topEndpoints[0].path, "/a");
  assertEquals(s.topEndpoints[0].count, 2);
  assertEquals(s.topEndpoints[0].errors, 1);
  assertEquals(s.topEndpoints[0].avgMs, 15);

  assertEquals(s.instance, "test-instance");
  assertEquals(typeof s.uptimeSeconds, "number");
});
