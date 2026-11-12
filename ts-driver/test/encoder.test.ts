import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCommand } from "../src/encoder.js";

test("encode command RESP", () => {
  assert.equal(
    encodeCommand(["SET", "k", "v"]).toString("utf8"),
    "*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\nv\r\n",
  );
});

test("encode command pakai byte length UTF-8", () => {
  assert.equal(
    encodeCommand(["SET", "nama", "é😀"]).toString("utf8"),
    "*3\r\n$3\r\nSET\r\n$4\r\nnama\r\n$6\r\né😀\r\n",
  );
});

test("encode command kosong -> throw", () => {
  assert.throws(() => encodeCommand([]), /cannot be empty/);
});
