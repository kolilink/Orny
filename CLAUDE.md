# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Orny** is a React Native (Expo) mobile app for managing a small chip factory — SOL Chips in Conakry, Guinea. The UI and all data labels are in French. Currency is GNF (Guinean Franc).

## Commands

```bash
# Start dev server (choose platform interactively)
npx expo start

# Start directly on a platform
npx expo start --ios
npx expo start --android

# Type-check
npx tsc --noEmit
```

There is no test suite. No linting config is present.

## Architecture

The app uses **Supabase** as its backend (`lib/supabase.ts`) and **AsyncStorage** as a local write-through cache. All store modules in `store/` follow this pattern: reads hit AsyncStorage immediately; writes go to AsyncStorage first then Supabase in the background; `sync*FromSupabase()` functions pull remote state into the cache.

**Authentication** is handled by `context/AuthContext.tsx` (via `AuthProvider` in `App.js`). It supports email/password and Google OAuth. On login, it resolves the user's `FactoryMembership` from Supabase and calls `setCurrentFactory(factoryId)` from `store/context.ts`. All store operations call `getFactoryId()` to obtain the current factory's UUID (the Supabase row ID, not `FACTORY_CONFIG.id`).

**`store/context.ts`** holds the in-memory factory ID and exports `setCurrentFactory`, `clearCurrentFactory`, `getFactoryId`, and `generateId` (UUID v4). This is the namespace used for AsyncStorage cache keys.

**`config/factory.ts`** still defines `FACTORY_CONFIG` but it's now used only for UI defaults (stock alert thresholds display, weekly target), not as the AsyncStorage key namespace.

**Navigation** (`navigation/index.tsx`) uses an `AuthGate` that renders:
- `LoginScreen` / `RegisterScreen` when unauthenticated
- `FactorySetupScreen` when authenticated but not yet a factory member (or join request pending)
- `AppNavigator` (Stack + Tab) when fully authenticated

Investors get a restricted tab navigator (Dashboard + Plus only). Admins and employees get the full tab set: Dashboard, Ventes, Production, Stock, Plus.

**`types/index.ts`** defines all shared interfaces and both navigation param lists (`RootStackParamList`, `TabParamList`).

**Screens** load data on `useFocusEffect` for refresh on navigation. New screens added since initial build: `screens/Auth/` (Login, Register, FactorySetup), `screens/Coach/`, `screens/FactorySettings/`, `screens/Profile/`.

**`store/profile.ts`** — display name is persisted to Supabase `profiles` table; avatar URI is stored locally in `expo-file-system` with a pointer in AsyncStorage.

**`db/schema.sql`** — Supabase schema. Run in the Supabase SQL Editor to set up tables (`factories`, `factory_members`, `sales`, `production_batches`, `stock_items`, `clients`, `investors`, `investment_entries`, `business_documents`, `flavors`, `bulk_products`, `join_requests`, `profiles`).

**Color palette** — every screen defines a local `C` constant:
`primary #1D9E75`, `background #F8F8F6`, `card #FFFFFF`, `muted #6B6B66`, `border #E8E8E4`, `red #E24B4A`, `orange #EF9F27`.

**`utils/format.ts`** — GNF formatting (`formatGNF`).  
**`utils/dates.ts`** — date helpers (`daysAgo`, `isToday`, `isThisWeek`, `getLast7Days`, `getDayLabel`).

## Key domain concepts

- **Roles** — `admin`, `employee`, `investor`. Investors see a restricted UI.
- **Flavors** (`ProductFlavor`) — product SKUs (e.g., SOL 80g). Managed in `store/flavors.ts`.
- **Bulks** (`BulkProduct`) — multi-bag bulk orders linked to a flavor. Managed in `store/bulks.ts`.
- **Sales** — three payment methods: `cash`, `orange_money`, `credit`. `amountPaid` tracks partial payments; `isSalePaid` / `saleDebt` helpers are in `types/index.ts`.
- **Production batches** — record potatoes used (kg), sachets produced, gas consumed, hours worked, and yield.
- **Stock** — four tracked inputs: `pommes_de_terre`, `huile`, `sachets_80g`, `gaz_lpg`. Alert thresholds defined in `FACTORY_CONFIG.stockAlerts`.
