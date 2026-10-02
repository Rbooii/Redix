export interface BackoffOptions {
    initialReconnectDelay: number;
    maxReconnectDelay: number;
    reconnectFactor: number;
}

export function computeReconnectDelay(
  attempt: number,
  opts: BackoffOptions,
  random: () => number = Math.random,
): number {
  const base = Math.min(
    opts.maxReconnectDelay,
    opts.initialReconnectDelay * opts.reconnectFactor ** attempt,
  );
  // equal jitter: hasil di 50%-100% dari base
  return Math.floor(base * (0.5 + 0.5 * random()));
}