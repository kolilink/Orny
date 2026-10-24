#!/bin/sh
# First test suite in this repo (there was no test suite, only tsc).
# Runs without a phone, network, or Supabase project.
#
# Order matters: the drain harness must run FIRST, because it installs
# the stubbed AsyncStorage + Supabase into the compiled output directory.
# The pure tests import the queue module, so they need those stubs in
# place before they can even load.
set -e
cd "$(dirname "$0")/.."
OUT=/tmp/orny-tests-out
rm -rf "$OUT"
npx tsc lib/syncQueue.ts lib/withTimeout.ts store/context.ts store/sales.ts store/stock.ts config/factory.ts \
  lib/syncQueue.test.ts lib/factoryToday.ts lib/factoryToday.test.ts types/index.ts \
  --module commonjs --target es2020 --moduleResolution node \
  --outDir "$OUT" --skipLibCheck
node tests/syncQueue.drain.test.cjs "$OUT"
node "$OUT/lib/syncQueue.test.js"
node "$OUT/lib/factoryToday.test.js"
echo "orny tests: all passed"
