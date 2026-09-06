type Signal = 'otp_provider' | 'otp_widget' | 'email_delivery' | 'email_worker';
type Counts = { successes: number; failures: number };

// Fixed-size, aggregate-only telemetry: never retain identifiers, OTPs or errors.
// Deliberately process-local; a restart resets the observation window.
export class OperationalMetrics {
  private buckets = new Map<number, Partial<Record<Signal, Counts>>>();
  readonly startedAt: number;

  constructor(private now: () => number = Date.now) { this.startedAt = now(); }

  record(signal: Signal, success: boolean): void {
    const minute = Math.floor(this.now() / 60_000);
    for (const key of this.buckets.keys()) if (key < minute - 59 || key > minute) this.buckets.delete(key);
    const bucket = this.buckets.get(minute) ?? {};
    const counts = bucket[signal] ?? { successes: 0, failures: 0 };
    const key = success ? 'successes' : 'failures';
    counts[key] = Math.min(1_000_000, counts[key] + 1);
    bucket[signal] = counts;
    this.buckets.set(minute, bucket);
  }

  snapshot(): Record<Signal, Counts> {
    const signals: Signal[] = ['otp_provider', 'otp_widget', 'email_delivery', 'email_worker'];
    const result = Object.fromEntries(signals.map((signal) => [signal, { successes: 0, failures: 0 }])) as Record<Signal, Counts>;
    const minute = Math.floor(this.now() / 60_000);
    for (const [key, bucket] of this.buckets) {
      if (key <= minute - 60 || key > minute) continue;
      for (const signal of signals) {
        result[signal].successes += bucket[signal]?.successes ?? 0;
        result[signal].failures += bucket[signal]?.failures ?? 0;
      }
    }
    return result;
  }
}

export const operationalMetrics = new OperationalMetrics();
