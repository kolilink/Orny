// Pure part of the sync queue, testable without a phone or Supabase:
// isNetworkError decides whether a failed write is queued for retry or
// surfaced as a real error. Getting this classification wrong is how a
// factory sale either retries forever (business error) or vanishes
// (network error treated as final).
//
// Same plain-assert style as factoryToday.test.ts — no test framework in
// this repo yet. Compile with tsc and run the output with node.
// The drain scenarios (success / network-stop / dead-letter) are covered
// by tests/syncQueue.drain.test.cjs, which stubs AsyncStorage + Supabase
// around the compiled queue module.
import { isNetworkError } from './syncQueue';

const check = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
};

// Network-shaped: must queue.
check(isNetworkError(new Error('Network request failed')), true, 'network request failed');
check(isNetworkError(new Error('Failed to fetch')), true, 'failed to fetch');
check(isNetworkError(new Error('fetch failed')), true, 'fetch failed');
check(isNetworkError(new Error('Network timeout after 12000ms')), true, 'timeout');
check(isNetworkError({ message: 'network error' }), true, 'network error object');
// Business / permission errors: must NOT queue — retrying them forever
// hides a real bug and never succeeds.
check(isNetworkError(new Error('new row violates row-level security policy')), false, 'RLS');
check(isNetworkError(new Error('duplicate key value violates unique constraint')), false, 'unique');
check(isNetworkError(new Error('invalid input value')), false, 'validation');
check(isNetworkError(null), false, 'null');
check(isNetworkError(undefined), false, 'undefined');

console.log('syncQueue (isNetworkError): all assertions passed');
