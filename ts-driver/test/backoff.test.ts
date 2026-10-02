import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconnectDelay } from "../src/backoff.js";

const opts = { initialReconnectDelay: 100, maxReconnectDelay: 3000, reconnectFactor: 2 };
const maxRng = () => 1; // jitter maksimum -> hasil = base
const minRng = () => 0; // jitter minimum -> hasil = base / 2

test("naik eksponensial", () => {
  assert.equal(computeReconnectDelay(0, opts, maxRng), 100);
  assert.equal(computeReconnectDelay(1, opts, maxRng), 200);
  assert.equal(computeReconnectDelay(2, opts, maxRng), 400);
  assert.equal(computeReconnectDelay(3, opts, maxRng), 800);
});

test("dibatasi maxReconnectDelay", () => {
  assert.equal(computeReconnectDelay(20, opts, maxRng), 3000);
});

test("jitter di rentang 50%-100%", () => {
  assert.equal(computeReconnectDelay(2, opts, minRng), 200);
  const d = computeReconnectDelay(2, opts);
  assert.ok(d >= 200 && d <= 400);
});