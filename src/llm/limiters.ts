export class TokenBucket {
  private tokens: number;
  private lastMs = Date.now();
  private readonly perMs: number; // tokens refilled per ms
  private readonly cap: number;

  constructor(tokensPerMinute: number) {
    const perMinute = Math.max(1, Math.floor(tokensPerMinute));
    this.cap = perMinute;
    this.tokens = perMinute; // start full
    this.perMs = perMinute / 60000; // per minute to per ms
  }

  private refill() {
    const now = Date.now();
    const dt = now - this.lastMs;
    if (dt > 0) {
      this.tokens = Math.min(this.cap, this.tokens + dt * this.perMs);
      this.lastMs = now;
    }
  }

  async acquire(n = 1) {
    if (n <= 0) return;
    for (;;) {
      this.refill();
      if (this.tokens >= n) { this.tokens -= n; return; }
      const need = n - this.tokens;
      const waitMs = Math.ceil(need / this.perMs);
      await new Promise(r => setTimeout(r, Math.max(1, waitMs)));
    }
  }
}

export class DayCounter {
  private count = 0;
  private nextResetMs: number;
  private readonly capacity: number;

  constructor(requestsPerDay: number) {
    this.capacity = Math.max(1, Math.floor(requestsPerDay));
    this.nextResetMs = DayCounter.nextUtcMidnightMs();
  }

  private static nextUtcMidnightMs(): number {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
    return next;
  }

  private maybeReset() {
    const now = Date.now();
    if (now >= this.nextResetMs) {
      this.count = 0;
      this.nextResetMs = DayCounter.nextUtcMidnightMs();
    }
  }

  async acquire(n = 1) {
    if (n <= 0) return;
    for (;;) {
      this.maybeReset();
      if (this.count + n <= this.capacity) { this.count += n; return; }
      const waitMs = Math.max(1, this.nextResetMs - Date.now());
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

export interface BudgetConfig {
  rpm?: number; // requests per minute
  rpd?: number; // requests per day
  tpm?: number; // tokens per minute (input+output)
  strictTpm?: boolean; // if true, try to reserve tokens pre-call when possible
}

export class BudgetManager {
  private reqPerMin?: TokenBucket;
  private reqPerDay?: DayCounter;
  private tokensPerMin?: TokenBucket;
  private strict: boolean;

  constructor(cfg: BudgetConfig) {
    if (cfg.rpm && cfg.rpm > 0) this.reqPerMin = new TokenBucket(cfg.rpm);
    if (cfg.rpd && cfg.rpd > 0) this.reqPerDay = new DayCounter(cfg.rpd);
    if (cfg.tpm && cfg.tpm > 0) this.tokensPerMin = new TokenBucket(cfg.tpm);
    this.strict = !!cfg.strictTpm;
  }

  get enabled() { return !!(this.reqPerMin || this.reqPerDay || this.tokensPerMin); }
  get strictTpm() { return this.strict; }

  async acquireRequest(expectedTokens?: number) {
    // RPD and RPM are pre-call gates
    if (this.reqPerDay) await this.reqPerDay.acquire(1);
    if (this.reqPerMin) await this.reqPerMin.acquire(1);
    // For strict TPM, pre-reserve expected tokens (if provided)
    if (this.tokensPerMin && this.strict && expectedTokens && expectedTokens > 0) {
      await this.tokensPerMin.acquire(expectedTokens);
    }
  }

  async noteUsage(usedTokens?: number, preReserved?: number) {
    if (!this.tokensPerMin) return;
    if (!usedTokens || usedTokens <= 0) return;
    const need = Math.max(0, usedTokens - (preReserved ?? 0));
    if (need > 0) await this.tokensPerMin.acquire(need);
  }
}

export function parseBool(v?: string): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

