# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Orny** is a React Native (Expo) mobile app for managing a small chip factory — SOL Chips in Conakry, Guinea. UI and all labels are in French. Currency is GNF (Guinean Franc). Deployed as a PWA via Netlify (GitHub → auto-deploy).

## Commands

```bash
# Dev server
npx expo start
npx expo start --ios
npx expo start --android
npx expo start --web        # PWA dev mode

# Type-check (no test suite, no linter)
npx tsc --noEmit

# Build web PWA for deploy
npx expo export --platform web   # outputs to dist/

# Push to GitHub triggers Netlify auto-deploy
git push origin main
```

No test suite. No linting config.

## Architecture

### Auth flow
`context/AuthContext.tsx` → `AuthProvider` wraps the app in `App.js`. On startup it calls `supabase.auth.getSession()` with an 8-second outer timeout. `applySession()` loads factory memberships and sets `membershipLoading = true` while running — **AuthGate blocks on both `loading` and `membershipLoading`** to prevent the FactorySetupScreen flash. Memberships are cached in AsyncStorage under `membership_cache_{userId}` so slow networks fall back to cache instead of showing an empty factory list.

Roles: `admin`, `employee`, `investor`, `vendeur` (added `update10.sql`). Investors get a restricted tab navigator (Dashboard + Plus only); vendeur gets Dashboard + Ventes + Plus (Plus limited to just Clients) — a market-stall seller can sell and manage clients but has no Production/Stock access, no pricing/catalog edit rights, and no visibility into Dépenses/Créances/Investisseurs/Rapports/Coach/Fournisseurs. RLS backs this at the DB level (`sales`/`clients` insert+update policies include `vendeur`; every other table's staff policies deliberately don't).

Email/password + Google OAuth were the only sign-in options; Apple added `signInWithApple()` (native `expo-apple-authentication` → `supabase.auth.signInWithIdToken`) since Apple Guideline 4.8 requires an equivalent option whenever a third-party login like Google is offered on iOS — the `expo-apple-authentication` dependency existed unused in `package.json` (and an unused `appleBtn` style already sat in `LoginScreen.tsx`) before this was actually wired up.

### Store pattern (all stores in `store/`)
Every store follows the same write-through cache pattern:
1. **Read** — hit AsyncStorage immediately (cache key = `${getFactoryId()}_${entity}`)
2. **Write** — write to AsyncStorage first, then sync to Supabase in `.then()`
3. **Sync** — `sync*FromSupabase()` pulls fresh data into the cache

`store/context.ts` holds the active factory UUID in memory. All stores call `getFactoryId()` for their cache namespace. `generateId()` produces UUID v4 for new records.

Full store list: `batches`, `bulks`, `clients`, `context`, `customCategories`, `customerOrders`, `demo`, `documents`, `expenses`, `flavors`, `investmentEntries`, `investorDistributions`, `investors`, `machines`, `production`, `products`, `profile`, `purchases`, `sales`, `stock`, `suppliers`, `weeklyTarget`.

**`store/production.ts` (the original `production_batches` table — potatoes/sachets/gas/hours/yield) is dead for writes.** Since the "Production rebuild" (`update8.sql`) moved actual batch-logging to `store/batches.ts`/`production_batches_v2` (generic product + recipe + `unitsProduced`), nothing calls `store/production.ts`'s `addBatch` anymore — the only `addBatch` call site in the app is `screens/Production/index.tsx`, which imports from `store/batches.ts`. Dashboard used to read the dead table (fixed — now reads `store/batches.ts` + the real per-factory `getWeeklyTarget()` instead of the hardcoded `FACTORY_CONFIG.weeklyProductionTarget`; the "Production cette semaine" card and the "Production en retard" banner were previously stuck at 0 forever for any factory using the current Production screen). **`utils/businessData.ts` (feeds the AI Coach) still reads the dead table and is NOT fixed** — its `sachets80g`/`potatoesUsedKg`/`hoursWorked`/`yieldGramsPerKg` fields have no equivalent in the new generic `Batch` model (which has `unitsProduced` + an arbitrary `materialsUsed` array, not a fixed potato/sachet/gas shape), so Coach's whole production-analysis section (yield, sachets-vs-sales coverage, hours worked) is confidently reporting zeros/stale data for any factory on the current Production screen. Fixing it needs a real redesign of `BusinessSnapshot.production` (and `utils/coachPrompt.ts`, which references those exact field names) around generic units — flagged here rather than fixed, since it changes what Coach's prompt data shape means, not a mechanical import swap like Dashboard's fix was.

**`utils/businessData.ts` was fixed to read the live production tables (2026-07-16).** It previously imported `getBatches` from the dead `store/production.ts` (see above) — `BusinessSnapshot.production` has been redesigned around the generic `Batch` model: `unitsProduced`/`hours` instead of `sachets80g`/`potatoesUsedKg`/`yieldGramsPerKg`, plus a `topProducts` (per-product breakdown) and `materialsConsumedWeek` (grouped by name+unit, since materials are now arbitrary per-recipe and can't be summed across units) field. `utils/coachPrompt.ts`'s `buildDataContext` was updated to match. This also unblocked `utils/runrate.ts` (below), which needs real per-material consumption history to compute anything.

**Stock is now a real finished-goods ledger, not just raw materials.** Every `ProductFlavor` and standalone `BulkProduct` (no `flavorId`) gets its own `stock_items` row (id = the flavor/bulk's own id), auto-created on creation and self-healed (backfilled at 0) for pre-existing ones in `Ventes`' `load()`. A `BulkProduct` that *does* have a `flavorId` has no stock of its own — it's a case of `bagCount` units of that flavor, so selling it deducts `bagCount × qty` from the flavor's own row (`resolveStockTarget()` in `screens/Ventes/index.tsx`). Before this, selling never touched stock at all (finished-goods counts only ever went up, via Production) and buying (`Suppliers > Achats`) never touched stock either — `store/purchases.ts`'s `addPurchase` now increments the linked `stock_item_id`'s level, and the purchase form has a real stock-item picker (with an inline "+ nouvelle matière première" escape hatch) instead of a free-text `product` field that was never connected to anything. `store/stock.ts`'s `checkStockAvailability()` is called before both a sale and a production batch commit — insufficient stock is a confirm-to-override dialog now, not a silent `Math.max(0, ...)` clamp with no warning beyond an easy-to-ignore orange banner.

**Purchases were invisible to the P&L.** `screens/Reports/index.tsx` only ever read `sales` + `expenses` — a raw-material purchase logged in `Suppliers > Achats` never reduced reported profit unless someone *also* re-entered it as an `expenses` row with category `matiere_premiere`. Reports now shows "Achats matières premières" as its own P&L line (`getPurchases()`), with an explicit on-screen warning against double-entering the same cost in both places — there's no automatic de-dupe between the two, that's still on the humans entering data.

**Investor payouts.** `investors`/`investment_entries` only ever tracked capital going *in*. `investor_distributions` (`update10.sql`) tracks capital paid *out* to an investor (profit share, refund, etc.) — admin-only write, investor can read their own. `Investors` screen nets it against `totalForInvestor()` and shows it as a separate red "−" line in the per-investor history, distinct from the green "+" investment entries.

**Business documents are backed up centrally now, not device-local only.** `business_documents.file_uri` used to be a `file://` path — the actual file "stayed on device" (literally the old comment in `store/documents.ts`), so it was unrecoverable on reinstall/loss and invisible to every other member. `update11.sql` adds a private `business-documents` Supabase Storage bucket (RLS keyed on the object path's first segment being the factory id, reusing `my_factory_ids()`/`my_role_in()`) and `business_documents.storage_path`. `addDocument` now uploads via `expo-file-system`'s base64 read + `base64-arraybuffer`'s `decode()` (the same `fetch().blob()`-returns-0-bytes-for-`file://`-URIs workaround documented elsewhere for RN/Hermes) in addition to keeping a same-device local copy for instant preview. `DocumentDetail.tsx` tries the local file first and falls back to a freshly-fetched signed URL (`getSignedDocumentUrl`, 1h expiry) when it's missing — e.g. a different device, or after a reinstall.

**Offline writes now retry instead of vanishing.** Every store's Supabase write used to be pure fire-and-forget — a failure just hit `console.warn` and moved on, with the local cache still showing the write as "saved." Since two of the three real investors using this app check numbers from a different device than whoever made the sale, a write that failed to reach Supabase because the factory floor had no signal was invisible to everyone except the one phone that made it. `lib/syncQueue.ts` is a small persisted (AsyncStorage) FIFO queue: every store's `.then(({error}) => ...)` now calls `enqueueIfNetworkError(error, {...})`, which only queues a *network-shaped* failure (a real RLS/validation rejection is still `console.warn`'d, since retrying that forever would never succeed and would hide an actual bug). `AppNavigator` (`navigation/index.tsx`) drains the queue on mount and on every `AppState` foreground; `<SyncBanner>` (absolute-positioned overlay, since there's no shared `<Screen>`-style wrapper here to thread real layout space through) shows "N modifications en attente de connexion" whenever the queue is non-empty. Not wired into `store/documents.ts` (the file upload itself has different failure semantics — retrying a multi-hundred-KB upload through a small metadata-shaped queue isn't worth it, same reasoning Patron's support-chat images use) or into `weeklyTarget`/`profile`/`customCategories` (low-stakes, not financial/inventory data).

### Navigation (`navigation/index.tsx`)
`AuthGate` renders:
- Spinner while `loading || membershipLoading`
- `LoginScreen` / `RegisterScreen` when no session
- `FactorySetupScreen` when session exists but no membership (new user or pending join)
- `AppNavigator` (Stack + Tab) when fully authenticated

Stack screens (push over tabs) must show a back button — they use `options={{ title: '...', headerTintColor: '#1D9E75' }}` in the navigator. `FactorySettings` and `Profile` manage their own custom back button and keep `headerShown: false`.

### Supabase client (`lib/supabase.ts`)
Uses `expo-secure-store` for session storage on native, falls back to `localStorage` on web (`Platform.OS === 'web'`). `detectSessionInUrl` is `true` on web only (needed for OAuth redirect).

### PWA / web compatibility
- `Alert.alert` with more than 2 buttons does **not** work on web — use a `Modal` with `TouchableOpacity` buttons instead (see approve flow in `screens/FactorySettings/index.tsx`).
- `expo-notifications` is skipped on web (`Platform.OS === 'web'` guard in `utils/notifications.ts`).
- Netlify config: `netlify.toml` sets `NODE_VERSION = "24"` (must match local Node version to keep `package-lock.json` compatible). The `dist/_redirects` rule and `[[redirects]]` in `netlify.toml` handle SPA routing.

### Orny AI (`screens/Coach/`, `supabase/functions/factory-chat/`, `supabase/functions/factory-voice/`)

Rebuilt 2026-07-16 from a client-side, bring-your-own-Anthropic-key chatbot ("Coach IA") into a single-purpose, server-mediated advisor. `utils/businessData.ts` → `getBusinessSnapshot()` still aggregates all stores into a `BusinessSnapshot` client-side (no SECURITY DEFINER RPC layer exists yet for a safe server-side re-fetch, unlike Patron's Alpha) — but the actual model call now goes through `factory-chat`, which holds `GROQ_API_KEY` (`llama-3.3-70b-versatile`) as a Supabase secret and is never reachable without a valid session + real `factory_members` row for the `factory_id` being asked about. The client never talks to Groq directly and never sees the key. `screens/Coach/index.tsx`'s old `API_KEY_STORAGE`/`callClaude`/SecureStore flow is gone entirely.

**System prompt doctrine (`utils/coachPrompt.ts`)** — one singular mission stated explicitly (help this factory make the best product possible, as efficiently as possible, from its own real numbers only), reasoning from three combined frameworks:
- **Musk's 5-step algorithm**, as the mandated order for any concrete problem posed to it: question the requirement → delete the step → simplify what's left → accelerate → automate last, never first.
- **Goldratt's Five Focusing Steps** (Theory of Constraints / *The Goal*): identify the constraint → exploit it fully before investing → subordinate everything else to it → elevate it → repeat, without letting inertia become the next constraint.
- **Toyota Production System**: muda/mura/muri, jidoka, JIT, kaizen, genchi genbutsu.
- Hormozi's revenue-velocity framing (collection rate, ATV, client concentration) carried over from the original prompt.

User-supplied strings (client names, factory name) are sanitised by `s()` in `coachPrompt.ts` to strip prompt-injection characters — unchanged from before.

**Voice mode.** A push-to-talk mic button (native only — `Platform.OS !== 'web'`) records via `expo-audio`, uploads to `factory-voice` (Groq Whisper `whisper-large-v3`, auto-detects language) using FormData's `{ uri, name, type }` object shape rather than `fetch(uri).blob()` — the latter returns a 0-byte blob for `file://` URIs in Hermes, the same gotcha documented for voice/image messages elsewhere in this workspace. The transcript is sent through the same `factory-chat` path as a typed message; the reply is spoken back via on-device `expo-speech` (not a cloud TTS API — free, offline-capable, covers pt/es/en/fr system voices, no added latency/cost/secret). A spoken question always gets a spoken reply regardless of settings; a typed message only auto-speaks if `profiles.voice_autoplay` is on (Profile screen toggle, off by default) — otherwise every AI bubble has a manual 🔊 tap-to-replay. `profiles.preferred_language` is a manual override; absent that, the locale used for TTS is whatever Whisper detected in the most recent voice message (`utils/voice.ts`'s `resolveLocale`). Built for accessibility, not just novelty — French is Orny's default UI language, but the model is instructed to always reply in whichever of French/Portuguese/Spanish/English it was addressed in, both by voice and by typed text.

**`expo-audio`/`expo-speech` are native modules** — added via `npx expo install`, `app.json` gained a configured `expo-audio` plugin entry (`microphonePermission` string, sets both iOS `NSMicrophoneUsageDescription` and Android `RECORD_AUDIO`). Per the OTA-vs-native-build distinction documented elsewhere in this workspace: this needs a real `eas build`, not just a Netlify/OTA-style JS push, before voice mode works on a device that doesn't already have these native modules compiled in.

**Groq key handling.** The live key was shared in a chat session during setup — treat it as exposed and rotate it in the Groq console at the next convenient point, same posture as the Djomi-key incident documented in the sibling Patron app's `CLAUDE.md`. It's stored only as the `GROQ_API_KEY` Supabase Edge Function secret, never in `.env`/`app.json`/any committed file.

### Notifications (`utils/notifications.ts`, `utils/notificationLog.ts`, `supabase/functions/dispatch-notification/`)

Two layers, both new as of 2026-07-16 beyond the original reactive local alerts:
- **Predictive stock alerts** (`checkPredictiveStockAlerts`) — distinct from the original reactive `checkStockAlerts` (fires once `currentLevel <= alertThreshold`). Uses `utils/runrate.ts`'s trailing-14-day consumption rate to warn when an item is projected to hit zero within 5 days, even while still above its threshold. Consumption is computed gross (production draw-down via `materialsUsed`, matched by `rawMaterialId`; finished-goods draw-down via `sales`, matched by product **name** since `Sale` carries no stock item id) — never netted against purchases/restocks, since `currentLevel` already reflects those and subtracting them again would understate the true burn rate.
- **Real push**, not just local `expo-notifications`. `push_tokens` (`update12.sql`, keyed by the Expo push token itself so one device keeps one row across logins) + `dispatch-notification` edge function — resolves recipients server-side from real `factory_members` rows, never trusts a client-supplied user list. Registered once per app open in `navigation/index.tsx`'s `AppNavigator` via `lib/pushToken.ts`, which silently no-ops until `extra.eas.projectId` exists (see "Store submission readiness" above — `eas init` hasn't been run yet).

Every alert (local or push-eligible) is also appended to `utils/notificationLog.ts`, a small on-device AsyncStorage list (last 50, per factory) — previously an alert vanished the moment it was dismissed from the OS tray with no in-app record at all. `screens/Notifications/` renders it.

### Machines (`screens/Machines/`, `store/machines.ts`)

Added 2026-07-16, ahead of real machine data being entered — `machines` (name, type, `rated_capacity`/`capacity_unit`, `status`: running/idle/down/maintenance) + `machine_status_log` (append-only status history, `update14.sql`). Same RLS posture as production/stock: admin/employee write, all members read, vendeur gets nothing extra. Already wired into `utils/businessData.ts`'s `BusinessSnapshot.machines` and `coachPrompt.ts`'s data context (renders "Aucune machine enregistrée" until populated) — the point of building this ahead of real data is that Orny AI can reason about actual-vs-rated capacity (a real Goldratt "exploit the constraint" signal) the moment machines are entered, with no further code changes.

### Design system (`theme/tokens.ts`, `components/ui/`)

Adopted app-wide 2026-07-16 — screens no longer define a local `C` constant per file (superseding the "Color palette" note that used to be here). Palette: `moss` (the one accent, unchanged brand green `#1D9E75`), `paper`/`ink`/`line`/`muted`/`card` for surface/text/border, `caution`/`critical` (a two-step warm severity gradient, replacing a flatter red/orange "alarm" pair — several screens like Créances' debt aging and Stock's level thresholds genuinely need two severity steps, not one). `components/ui/AppModal.tsx` is the one modal/sheet primitive: bottom sheet on phone-width viewports, centered dialog on tablet/desktop PWA widths (`useWindowDimensions`, not `Platform.OS`, since the same PWA build serves both), built on RN's built-in `Animated` (no `react-native-reanimated` dependency, keeping this app's footprint small for low-end Android devices). `ConfirmDialog` (built on `AppModal`) replaces the copy-pasted confirm-overlay pattern previously duplicated per screen. `Toast`/`toast.success()` mirrors Patron's `AppToast` ergonomics (separate implementation).

### Key domain concepts
- **Sales** — `cash`, `orange_money`, `credit`. `amountPaid` tracks partial payments. `isSalePaid` / `saleDebt` helpers live in `types/index.ts`.
- **Production batches** — generic since the "Production rebuild" (`update8.sql`): a `Batch` has `unitsProduced` + an arbitrary `materialsUsed` array (not a fixed potato/sachet/gas shape). The legacy `ProductionBatch` type (potatoes/sachets/gas/hours/yield) only describes the dead `store/production.ts` table.
- **Stock** — a real finished-goods + raw-materials ledger (see "Stock is now a real finished-goods ledger" above), not the original fixed four-input model. Thresholds are per-item (`stock_items.alert_threshold`), not `FACTORY_CONFIG.stockAlerts`.
- **Inventory runrate** (`utils/runrate.ts`) — trailing-14-day daily consumption + projected days-of-cover per stock item, feeding both predictive notifications and Orny AI's data block.
- **Expenses** — 7 categories: `loyer`, `salaire`, `matiere_premiere`, `energie`, `transport`, `maintenance`, `autre`. Drive real P&L in Dashboard and Reports.
- **Customer orders** — pipeline: `pending → ready → delivered / cancelled`. Late-delivery alerts on Dashboard open.
- **Créances** — debt aging grouped by client, color-coded by age, from existing `sales` table (no extra table).
- **Multi-factory** — `allMemberships` + `switchFactory()` in AuthContext. Last-used factory persisted in AsyncStorage key `active_factory_id`.
- **Weekly target** — stored per-factory in AsyncStorage via `store/weeklyTarget.ts`. Editable by admin in `screens/FactorySettings/`.

### DB migrations

Run in order in the Supabase SQL Editor — never skip versions. All `update*` files are safe to re-run (idempotent unless noted).

| File | What it adds |
|------|-------------|
| `db/schema.sql` | Base schema, RLS helpers `my_factory_ids()` / `my_role_in()` |
| `db/update4.sql` | `expenses`, `suppliers`, `purchases`, `customer_orders` tables + RLS |
| `db/update5.sql` | `user_id` column on `investors` |
| `db/update6.sql` | Admin delete policy on `factories` |
| `db/update7.sql` | `invite_lookup_log` rate-limit table |
| `db/update8.sql` | Production rebuild — `production_products` table with JSONB `last_recipe` |
| `db/update9_security_fix.sql` | Security hardening — restores `SET search_path` on `upsert_my_profile` and other SECURITY DEFINER functions |
| `db/update10.sql` | Adds the `vendeur` role (`factory_members`/`join_requests` role CHECK constraints + `sales`/`clients` insert+update RLS); `investor_distributions` table (capital paid *out* to an investor — RLS: admin write, investor reads their own); `purchases.stock_item_id` column so a purchase can be linked to (and increment) a real stock row |
| `db/update11.sql` | Private `business-documents` Supabase Storage bucket + `business_documents.storage_path` — RLS on `storage.objects` keyed on the object path's first segment being the factory id (`<factory_id>/<document_id>.<ext>`), reusing `my_factory_ids()`/`my_role_in()`. Business documents used to be device-local only; see "Business documents" note above. |
| `db/update12.sql` | `push_tokens` table (real server-triggered push, on top of the existing local-only `expo-notifications` alerts) — keyed by the Expo push token itself so one device keeps one row across logins; RLS lets a device write only its own row, no client SELECT policy (`dispatch-notification` reads via service role). |
| `db/update13.sql` | `profiles.preferred_language` + `profiles.voice_autoplay` — Orny AI voice mode preferences (manual language override; auto-read-aloud toggle, off by default). |
| `db/update14.sql` | `machines` + `machine_status_log` (append-only status history) — see "Machines" below. Same admin/employee-write, all-member-read RLS posture as production/stock. |
| `db/update15.sql` | Attribution (`created_by`, server-stamped via trigger) on every money-moving table; append-only edit history (`sale_edits`/`investment_entry_edits`, SECURITY DEFINER-trigger-only writes, no client policy at all — not even admin can edit or delete a trace); `purchases.amount_paid`; weighted-average cost (`stock_items.avg_cost`, `sales.cost_amount`) so Reports can compute real profit instead of expensing a purchase in the month it happened to be bought; the `inspecteur` read-only role (structurally enforced — never added to any write policy, and `investors`/`investment_entries` reads explicitly exclude it). |
| `db/update16.sql` | `delete_my_account()` — in-app self-service account deletion (Apple Guideline 5.1.1(v)). Same leave-vs-delete-vs-refuse shape as Patron's `leave_or_delete_business`: not admin anywhere blocking → leaves every factory; sole admin+sole member of a factory → that factory is deleted with the account; admin of a factory with others still in it → refused outright, naming the factory. Every FK to `auth.users`/`factories` in this schema is already `cascade`/`set null`, so deleting the `auth.users` row does the rest for free. |
| `db/update17_security_hardening.sql` | Fix, found live via `supabase db advisors --linked` (not a code read): `lookup_factory_by_code(text)` was directly callable by both `anon` and `authenticated` via `/rest/v1/rpc/lookup_factory_by_code` — confirmed with a raw curl call, not just the advisor's say-so. The app never calls this RPC directly; only the `lookup-factory` edge function does (over its own service-role client), after enforcing a 5-attempts/60s per-IP throttle via `invite_lookup_log`. Calling the RPC straight from a client with only the public anon key skipped that edge function — and its rate limit — entirely, so every 8-character invite code was brute-forceable with zero throttling. Fixed with `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` (service-role is untouched by that revoke — Supabase grants it EXECUTE independently at project bootstrap, so the edge function itself keeps working, verified live post-fix). The advisor also flags `my_factory_ids`/`my_role_in`/`approve_join_request`/`get_my_invite_code`/`upsert_my_profile` as "authenticated can execute" — those are intentional, not bugs: the first two are called directly by every RLS policy in the schema (revoking `authenticated` there would break the whole app), the rest are real app-facing RPCs that already do their own `auth.uid()`-scoped checks internally. **Any new RPC meant only for an edge function's service-role client, never the app itself, needs this same explicit revoke — a function is `PUBLIC`-executable by default the moment it's created, regardless of whether any client code happens to call it that way.** |
| `db/update18_reconciliation.sql` | Data-integrity reconciliation, Patron-style — see "Reconciliation" below. `reconciliation_findings` table + `run_factory_reconciliation(p_factory_id)` (admin-only SECURITY DEFINER RPC), wired to a "Vérifier" action in FactorySettings. |

`db/master.sql` combines the base schema + all updates for a fresh install — **currently stops at update14 and has not been updated to fold in update15/16/17/18** (attribution/edit-history/inspecteur, account deletion, the RPC lockdown, and reconciliation above); a from-scratch install off `master.sql` alone would be missing all four until it's regenerated. `db/repair.sql` is a one-off fix script (not part of the regular migration chain).

### Reconciliation (`db/update18_reconciliation.sql`, FactorySettings → "Vérification des données")

"If something is wrong, we will know" — a fixed set of SQL checks, run on demand by an admin, that re-derive facts from the raw tables and flag anywhere they disagree with a stored/computed value. Deliberately scoped to what this schema can actually support, not a port of Patron's 78-check system: Orny has **no append-only stock-movement ledger** (unlike Patron's `stock_moves`) — `stock_items.current_level` is a running total with no history to replay it against — so "does stock match its own movement history" isn't buildable yet; that needs a real ledger (every sale/purchase/production-batch write site instrumented), which is separate scope, not something to fake inside a reconciliation pass. What the current checks cover: row-level arithmetic (`sales`/`purchases`/`customer_orders` totals vs `quantity × unit_price`, overpayment, negative/invalid values), `stock_items.current_level < 0`, invalid expense amounts, and investor distributions exceeding investor contributions (the one aggregate-vs-aggregate check, mirroring Patron's check #77 for capital injections/withdrawals).

**A first version had a 7th check — `investors.amount_invested` vs `sum(investment_entries.amount)` — that looked like the same "cached snapshot vs. ledger" shape as every other check here, and wasn't.** `screens/Investors/index.tsx`'s `handleSaveInvestor()` deliberately writes a new investor's typed "initial amount" into a real `investment_entries` row, then zeroes `amount_invested` right back to 0 in the same flow — 0-vs-a-real-entries-sum is the correct, intended terminal state for every investor created this way, not drift. Caught by actually running the function against production before calling it done: the very first real run flagged a genuine investor (0 vs 4,653,000 GNF in entries) as a false positive. Removed rather than patched — `amount_invested` has no invariant left to check once you know its real lifecycle, it's a legacy field whose value only matters for rows that predate `investment_entries`. **Lesson for any future check here: two fields that look like "cache vs. source of truth" only actually are one if you've traced the write path that's supposed to keep them in sync — read the code that writes both sides before assuming disagreement means corruption.**

**The guard itself was also wrong on the first pass, and this one was a real, live security bug, not a false positive.** `run_factory_reconciliation` is `SECURITY DEFINER`, so its own `RETURN QUERY` reads `reconciliation_findings` with RLS bypassed internally — the admin check inside the function body is the *only* real gate, the table's RLS policy doesn't help here. The first version wrote it as `if my_role_in(p_factory_id) <> 'admin' then raise exception`, exactly the NULL-bypass shape documented at length in the sibling Patron app's `CLAUDE.md`: for a caller who isn't a member of `p_factory_id` at all, `my_role_in()` returns NULL, `NULL <> 'admin'` is NULL, and `if NULL then raise` is silently skipped in PL/pgSQL — so any authenticated user, member of any factory or none, could pass an arbitrary `p_factory_id` and get back that factory's real sales/investor figures in the returned `message` text, plus wipe its `reconciliation_findings` history as a side effect of the `DELETE` that runs before the checks. Caught before ever being reachable from the app (raw SQL testing via `supabase db query --linked` naturally runs with `auth.uid()` NULL, which is exactly the condition that triggers the bug) and fixed with the safe `if not exists (select 1 from factory_members where factory_id = p_factory_id and user_id = auth.uid() and role = 'admin')` pattern — verified live post-fix, both that a non-admin call now raises and that a real admin call still returns findings. **Any new SECURITY DEFINER function with an internal role guard must use `NOT EXISTS (...)`, never `my_role_in(...) <> 'x'` or `= 'x'` in a PL/pgSQL `IF` — that comparison-based form is only safe inside an RLS `USING`/`WITH CHECK` clause, where Postgres treats a NULL result as deny; the exact same expression inside a plain `IF` statement treats NULL as "don't raise," which is the opposite of safe.**

No cron/email delivery yet (Orny has none of Patron's `pg_cron`/Resend infrastructure) — this is on-demand only, triggered by an admin tapping "Vérifier" in FactorySettings. A scheduled version (daily, pushed via `dispatch-notification` to admins when findings exist) is a natural next step once this on-demand version has proven itself against real data for a while, not built preemptively.

### Security audit (2026-09-05)

Ran a full pass over RLS policies, every SECURITY DEFINER RPC, all four edge functions (`lookup-factory`, `dispatch-notification`, `factory-chat`, `factory-voice`), and `AuthContext.tsx`, using `supabase db advisors --linked` against the live project (ref `mtjyeexwvwrhwjzmttmc`) as ground truth rather than trusting a source-code read alone — the one real finding (`lookup_factory_by_code`'s rate-limit bypass) is now `update17_security_hardening.sql` above, applied to production and verified live (edge function still returns `{"factory":null}` for a bad code; the direct RPC now returns `42501 permission denied`).

Confirmed **not** vulnerable to Patron's own historical NULL-bypass bug class (documented in the sibling app's `CLAUDE.md`): every RLS policy here uses `my_role_in(factory_id) = 'admin'` / `IN (...)` predicates, and Postgres RLS treats a NULL predicate result as deny — unlike a PL/pgSQL `IF NOT (role = ...) THEN RAISE` guard, where a NULL condition silently evaluates to false and skips the check. `my_role_in()` returns NULL for a non-member by construction, so a non-member/wrong-role caller is denied by every single policy in the schema, not just the ones someone remembered to double-guard. `approve_join_request()` (the one write RPC with its own hand-written PL/pgSQL guard, not just RLS) uses an explicit `if not exists (select 1 from factory_members where ...)` — correctly fails closed regardless of NULL, not the vulnerable pattern.

Client-side omissions that looked like gaps on first read but are safe because RLS is the real gate (same "frontend is defense-in-depth" posture as Patron): `AuthContext.tsx`'s `updateMemberRole`/`removeMember` never check the caller is admin, and `rejectJoinRequest` never filters by `factory_id` — all three rely entirely on `factory_members`'/`join_requests`' own admin-only UPDATE/DELETE policies, verified present and correctly scoped in `master.sql`.

### Store submission readiness

Before this pass, `app.json` had no `ios.bundleIdentifier`/`android.package` and there was no `eas.json` at all — an EAS build could not have been produced. Both now exist: **`com.kolilink.orny` is a placeholder bundle id/package name** and needs to be confirmed (or changed) before the first real build — it must match whatever's registered in App Store Connect / Play Console, and effectively can't change after the first submission. `app.json` also gained `NSCameraUsageDescription`/`NSPhotoLibraryUsageDescription` (via the `expo-image-picker` config plugin) — without these, invoking the picker from Documents/Profile crashes on a real iOS device and App Review rejects the missing strings outright. Still needed before a real build: `eas init`/`eas build:configure` against a real Expo account to populate `extra.eas.projectId` (not something fabricatable without live credentials), and the actual Apple Developer / Play Console app registrations.

### Color palette
Superseded 2026-07-16 — see "Design system" above. `theme/tokens.ts` is now the single source of truth; no screen should define a local `C` constant going forward.
