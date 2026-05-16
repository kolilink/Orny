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

Roles: `admin`, `employee`, `investor`. Investors get a restricted tab navigator (Dashboard + Plus only).

### Store pattern (all stores in `store/`)
Every store follows the same write-through cache pattern:
1. **Read** — hit AsyncStorage immediately (cache key = `${getFactoryId()}_${entity}`)
2. **Write** — write to AsyncStorage first, then sync to Supabase in `.then()` (fire-and-forget)
3. **Sync** — `sync*FromSupabase()` pulls fresh data into the cache

`store/context.ts` holds the active factory UUID in memory. All stores call `getFactoryId()` for their cache namespace. `generateId()` produces UUID v4 for new records.

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

### AI Coach (`screens/Coach/`)
`utils/businessData.ts` → `getBusinessSnapshot()` aggregates all stores into a `BusinessSnapshot`. `utils/coachPrompt.ts` builds the system prompt (Hormozi + Goldratt frameworks) and data context string. User-supplied strings (client names, factory name) are sanitised by `s()` in `coachPrompt.ts` to strip prompt-injection characters.

### Key domain concepts
- **Sales** — `cash`, `orange_money`, `credit`. `amountPaid` tracks partial payments. `isSalePaid` / `saleDebt` helpers live in `types/index.ts`.
- **Production batches** — potatoes (kg), sachets, gas, hours, yield g/kg.
- **Stock** — four inputs: `pommes_de_terre`, `huile`, `sachets_80g`, `gaz_lpg`. Thresholds in `FACTORY_CONFIG.stockAlerts`.
- **Expenses** — 7 categories: `loyer`, `salaire`, `matiere_premiere`, `energie`, `transport`, `maintenance`, `autre`. Drive real P&L in Dashboard and Reports.
- **Customer orders** — pipeline: `pending → ready → delivered / cancelled`. Late-delivery alerts on Dashboard open.
- **Créances** — debt aging grouped by client, color-coded by age, from existing `sales` table (no extra table).
- **Multi-factory** — `allMemberships` + `switchFactory()` in AuthContext. Last-used factory persisted in AsyncStorage key `active_factory_id`.
- **Weekly target** — stored per-factory in AsyncStorage via `store/weeklyTarget.ts`. Editable by admin in `screens/FactorySettings/`.

### DB migrations
`db/schema.sql` — base schema. `db/update4.sql` — adds `expenses`, `suppliers`, `purchases`, `customer_orders` tables with RLS. Run both in the Supabase SQL Editor. RLS uses `my_factory_ids()` and `my_role_in()` helper functions defined in the base schema.

### Color palette
Every screen defines a local `C` constant — never import a global theme:
`primary #1D9E75`, `bg #F8F8F6`, `card #FFFFFF`, `muted #6B6B66`, `border #E8E8E4`, `red #E24B4A`, `orange #EF9F27`.
