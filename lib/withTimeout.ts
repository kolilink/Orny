// Every store's write-through cache pattern (see the root CLAUDE.md) reads
// AsyncStorage first, then calls a sync*FromSupabase() in the background to
// refresh it — with a correct fallback to the cache on a real network
// error. That fallback can only ever run if the fetch actually rejects.
// Under some real-world network conditions (a dead/captive wifi, not just
// true airplane mode) the underlying fetch can hang indefinitely instead of
// rejecting, so `loading` never resolves and the cache-fallback code —
// however correct — never executes. This is the exact bug class already
// found and fixed extensively in this workspace's sibling Patron app, via
// live airplane-mode device testing (static code review alone can't catch
// it, since the bug is in whether the catch block is ever reached at all,
// not in what it does once reached) — this file exists so Orny doesn't
// have to rediscover the same failure mode the same way.
//
// Races the given promise (or Supabase's thenable query builder, which
// isn't technically a Promise instance but works fine with Promise.race)
// against a flat timer; a timeout throws a message containing "network
// timeout", which reads identically to a real fetch failure to any caller
// that branches on `error || !data` or a try/catch.
export function withTimeout<T>(promise: PromiseLike<T>, ms = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Network timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
