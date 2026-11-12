export { Redix, Redix as RedixClient } from "./client.js";
export type { RedixEvents, RedixOptions } from "./client.js";

export { Connection } from "./connection.js";
export type {
  ConnectionEvents,
  ConnectionOptions,
  ConnectionState,
} from "./connection.js";

export {
  RedixAuthError,
  RedixConnectionError,
  RedixError,
  RedixProtocolError,
  RedixQueueFullError,
  RedixServerError,
  RedixTimeoutError,
} from "./errors.js";

export { encodeCommand } from "./encoder.js";
export { tryParseReply } from "./decoder.js";
export type { ParseResult, RespReply } from "./types.js";
