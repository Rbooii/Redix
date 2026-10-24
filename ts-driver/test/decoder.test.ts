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

test("simple string", () => {
  const parsed = tryParseReply(Buffer.from("+OK\r\n"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "simple", value: "OK" });
  assert.equal(parsed.consumed, 5);
});

test("error reply", () => {
  const parsed = tryParseReply(Buffer.from("-ERR boom\r\n"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "error", value: "ERR boom" });
  assert.equal(parsed.consumed, 11);
});

test("integer", () => {
  const parsed = tryParseReply(Buffer.from(":42\r\n"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "integer", value: 42 });
  assert.equal(parsed.consumed, 5);
});

test("bulk string", () => {
  const parsed = tryParseReply(Buffer.from("$5\r\nhello\r\n"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "bulk", value: "hello" });
  assert.equal(parsed.consumed, 11);
});

test("null bulk ($-1)", () => {
  const parsed = tryParseReply(Buffer.from("$-1\r\n"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "bulk", value: null });
  assert.equal(parsed.consumed, 5);
});

test("empty bulk ($0) bukan null", () => {
  const parsed = tryParseReply(Buffer.from("$0\r\n\r\n"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "bulk", value: "" });
  assert.equal(parsed.consumed, 6);
});

test("unicode 2-byte (é)", () => {
  const parsed = tryParseReply(Buffer.from("$2\r\né\r\n", "utf8"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "bulk", value: "é" });
  assert.equal(parsed.consumed, 8);
});

test("unicode 4-byte (😀)", () => {
  const parsed = tryParseReply(Buffer.from("$4\r\n😀\r\n", "utf8"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "bulk", value: "😀" });
  assert.equal(parsed.consumed, 10);
});

test("bulk boleh berisi CRLF di dalam data", () => {
  const parsed = tryParseReply(Buffer.from("$4\r\na\r\nb\r\n", "utf8"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "bulk", value: "a\r\nb" });
  assert.equal(parsed.consumed, 10);
});

test("array dua bulk string", () => {
  const parsed = tryParseReply(Buffer.from("*2\r\n$1\r\na\r\n$1\r\nb\r\n", "utf8"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, {
    type: "array",
    value: [
      { type: "bulk", value: "a" },
      { type: "bulk", value: "b" },
    ],
  });
  assert.equal(parsed.consumed, 18);
});

test("null array (*-1)", () => {
  const parsed = tryParseReply(Buffer.from("*-1\r\n"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, { type: "array", value: null });
  assert.equal(parsed.consumed, 5);
});

test("nested array", () => {
  const parsed = tryParseReply(Buffer.from("*2\r\n*1\r\n$1\r\na\r\n*-1\r\n", "utf8"));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.reply, {
    type: "array",
    value: [
      { type: "array", value: [{ type: "bulk", value: "a" }] },
      { type: "array", value: null },
    ],
  });
  assert.equal(parsed.consumed, 20);
});

test("prefix tidak lengkap -> null", () => {
  assert.equal(tryParseReply(Buffer.from("+OK")), null);
  assert.equal(tryParseReply(Buffer.from("$5\r\nhel")), null);
  assert.equal(tryParseReply(Buffer.from("*2\r\n$1\r\na\r\n")), null);
  assert.equal(tryParseReply(Buffer.alloc(0)), null);
});