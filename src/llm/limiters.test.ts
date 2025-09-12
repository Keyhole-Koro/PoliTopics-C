import { TokenBucket, DayCounter } from "@llm/limiters";

describe("limiters", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });
  afterEach(() => { jest.useRealTimers(); });

  test("TokenBucket enforces per-minute capacity (unit)", async () => {
    const bucket = new TokenBucket(2); // 2 per minute
    const t0 = Date.now();

    const p1 = bucket.acquire(1);
    const p2 = bucket.acquire(1);
    const p3 = bucket.acquire(1); // must wait ~30s to refill 1 token

    await Promise.all([
      p1,
      p2,
      (async () => {
        let resolved = false; p3.then(() => { resolved = true; });
        await jest.advanceTimersByTimeAsync(29_000);
        expect(resolved).toBe(false);
        await jest.advanceTimersByTimeAsync(1_100);
        expect(resolved).toBe(true);
      })(),
    ]);

    expect(Date.now()).toBeGreaterThanOrEqual(t0 + 30_000);
  });

  test("TokenBucket accounts partial refill for larger n (unit)", async () => {
    const bucket = new TokenBucket(100);
    await bucket.acquire(80); // immediate (bucket starts full)
    const p2 = bucket.acquire(80); // needs ~60 tokens => 36s
    let resolved = false; p2.then(() => { resolved = true; });
    await jest.advanceTimersByTimeAsync(35_000);
    expect(resolved).toBe(false);
    await jest.advanceTimersByTimeAsync(1_500);
    expect(resolved).toBe(true);
  });

  test("DayCounter resets at next UTC midnight (unit)", async () => {
    // Move clock near midnight to keep test fast
    jest.setSystemTime(new Date("2025-01-01T23:59:00Z"));
    const day = new DayCounter(1);

    await day.acquire(1); // uses daily capacity
    const p2 = day.acquire(1); // must wait until next UTC midnight

    let resolved = false; p2.then(() => { resolved = true; });
    await jest.advanceTimersByTimeAsync(59_000);
    expect(resolved).toBe(false);
    await jest.advanceTimersByTimeAsync(2_000); // cross midnight
    expect(resolved).toBe(true);
  });
});

