/**
 * A token bucket per key, in memory.
 *
 * Chose a token bucket over a fixed-window counter. A fixed window is fewer
 * lines, but it lets through twice the limit across a window boundary — spend
 * the whole allowance in the last second of one window and the whole allowance
 * again in the first second of the next. A bucket refills continuously, so the
 * long-run rate is the limit and the only burst is the capacity itself, which
 * is the burst you actually chose.
 *
 * Rejected a Postgres-backed limiter. It would survive a restart and work
 * across processes, at the cost of a write on every request — and this is one
 * process on localhost, where a restart resetting the counters is not a threat
 * anyone is defending against. Would switch if this ever ran more than one
 * instance, because per-process counters silently multiply the real limit by
 * the number of processes.
 */

export type Limit = {
  /** Requests allowed in a burst, and the long-run rate over `perSeconds`. */
  capacity: number;
  perSeconds: number;
};

type Bucket = { tokens: number; updatedAt: number };

export type Decision = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Past this many tracked keys, full buckets are swept. Dropping a full bucket
 * loses nothing: a full bucket and a key never seen before behave identically,
 * so the sweep cannot let anyone through who would otherwise be blocked.
 *
 * What it does not solve: enough *simultaneously throttled* keys to fill the
 * map anyway. That is a distributed attack, and it is the point at which an
 * in-memory limiter is the wrong tool rather than a badly tuned one.
 */
const SWEEP_ABOVE = 10_000;

export type Limiter = {
  take(key: string): Decision;
  /** Tracked keys — exposed so a test can prove the sweep actually sweeps. */
  size(): number;
};

export function rateLimiter(limit: Limit, now: () => number = Date.now): Limiter {
  const buckets = new Map<string, Bucket>();
  const perMs = limit.capacity / (limit.perSeconds * 1000);

  /**
   * Tokens are only refilled when a key is read, so a stored count is stale by
   * however long the key has been idle — and idle is exactly the state this
   * sweep is looking for. Comparing the stored number would therefore never
   * find anything to drop, which is what the first version of this did.
   */
  function sweep(at: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.tokens + (at - bucket.updatedAt) * perMs >= limit.capacity) {
        buckets.delete(key);
      }
    }
  }

  return {
    size: () => buckets.size,

    take(key) {
      const at = now();
      const bucket = buckets.get(key) ?? { tokens: limit.capacity, updatedAt: at };

      // Refill for the elapsed time, then spend. Storing a timestamp and
      // computing the refill on read means no timer and no background sweep —
      // a bucket nobody touches costs nothing until it is touched again.
      bucket.tokens = Math.min(limit.capacity, bucket.tokens + (at - bucket.updatedAt) * perMs);
      bucket.updatedAt = at;

      if (bucket.tokens < 1) {
        buckets.set(key, bucket);
        return { ok: false, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / perMs / 1000) };
      }

      bucket.tokens -= 1;
      buckets.set(key, bucket);
      if (buckets.size > SWEEP_ABOVE) sweep(at);
      return { ok: true };
    },
  };
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  // A typo in an env var must not silently disable the limiter.
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/**
 * Two limits, because one is not enough.
 *
 * `auth` is per IP and covers registration and login together. `account` is per
 * *email* and exists because per-IP alone is defeated by anyone with more than
 * one address — a botnet, or just one IPv6 allocation. Guessing one person's
 * password from ten thousand addresses trips no per-IP counter.
 *
 * Both are overridable so the smoke test can set them low enough to prove the
 * 429 against a real socket without sending sixty requests to get there.
 */
export const LIMITS = {
  auth: { capacity: envInt("RATE_LIMIT_AUTH", 60), perSeconds: 15 * 60 },
  account: { capacity: envInt("RATE_LIMIT_ACCOUNT", 10), perSeconds: 15 * 60 },
} satisfies Record<string, Limit>;
