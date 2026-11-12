export class RedixError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class RedixConnectionError extends RedixError {
  constructor(
    message: string,
    code: "CONNECTION_CLOSED" | "CONNECTION_LOST" | "NOT_CONNECTED" = "CONNECTION_LOST",
    options?: ErrorOptions,
  ) {
    super(message, code, options);
  }
}

export class RedixTimeoutError extends RedixError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "COMMAND_TIMEOUT", options);
  }
}

export class RedixQueueFullError extends RedixError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "OFFLINE_QUEUE_FULL", options);
  }
}

export class RedixProtocolError extends RedixError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "PROTOCOL_ERROR", options);
  }
}

export class RedixServerError extends RedixError {
  readonly reply: string;
  readonly prefix: string;

  constructor(reply: string, code?: string, options?: ErrorOptions) {
    const prefix = reply.trim().split(/\s+/, 1)[0] || "ERR";
    super(reply, code ?? prefix, options);
    this.reply = reply;
    this.prefix = prefix;
  }
}

export class RedixAuthError extends RedixServerError {
  constructor(reply: string, options?: ErrorOptions) {
    super(reply, "AUTH_FAILED", options);
    this.name = "RedixAuthError";
  }
}
