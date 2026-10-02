import { test } from "node:test"
import assert from "node:assert/strict"
import { tryParseReply } from "../src/decoder.js";

test("fragmentasi: satu reply dipecah di semua posisi", () => {
  const full = Buffer.from("*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\nv\r\n", "utf8");

  for (let split = 1; split < full.length; split++) {
    const prefix = full.subarray(0, split);
    assert.equal(tryParseReply(prefix), null, `prefix panjang ${split} harus null`);

    const combined = Buffer.concat([prefix, full.subarray(split)]);
    const parsed = tryParseReply(combined);
    assert.ok(parsed, `gabungan di split ${split} harus valid`);
    assert.equal(parsed.consumed, full.length);
  }
});

test("coalescing: dua reply dalam satu buffer", () => {
  const buf = Buffer.from("+OK\r\n:42\r\n", "utf8");

  const first = tryParseReply(buf);
  assert.ok(first);                          // assertion function -> narrowing
  assert.deepStrictEqual(first.reply, { type: "simple", value: "OK" });
  assert.equal(first.consumed, 5);

  const second = tryParseReply(buf, first.consumed);
  assert.ok(second);
  assert.deepStrictEqual(second.reply, { type: "integer", value: 42 });
  assert.equal(second.consumed, 5);
});

test("angka tidak valid -> throw", () => {
  assert.throws(() => tryParseReply(Buffer.from("$abc\r\n")), /angka tidak valid/);
});