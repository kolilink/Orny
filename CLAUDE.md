# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Corning** is a React Native (Expo) mobile app for managing a small chip factory — SOL Chips in Conakry, Guinea. The UI and all data labels are in French. Currency is GNF (Guinean Franc).

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

All data is stored locally on the device using `@react-native-async-storage/async-storage`. There is no backend or network layer. Each entity module in `store/` owns its AsyncStorage key (prefixed with `FACTORY_CONFIG.id`), and exports async CRUD functions (`get*`, `add*`, `update*`, `delete*`, `set*`).

**`config/factory.ts`** is the single source of truth for factory identity (`id`, `name`, `currency`, `weeklyProductionTarget`, stock alert thresholds). This `id` is used as the namespace prefix for all AsyncStorage keys.

**`types/index.ts`** defines all shared interfaces (`Sale`, `ProductionBatch`, `StockItem`, `Client`, `Investor`, `BusinessDocument`, `ProductFlavor`, `BulkProduct`, `InvestmentEntry`) plus the navigation param lists (`RootStackParamList`, `TabParamList`).

**Navigation** (`navigation/index.tsx`) uses a root `Stack.Navigator` with a nested `Tab.Navigator`. The bottom tabs are: Dashboard, Ventes, Production, Stock, Plus. The Plus tab acts as a menu that navigates to stack screens (Documents, Clients, Investors, Reports, Flavors, Bulks).

**Screens** in `screens/` load data on `useFocusEffect` so they refresh every time the user navigates back to them.

**`store/demo.ts`** seeds demo data into AsyncStorage on first app launch (guarded by a `demo_loaded_v2` key). `seedFlavors` runs separately (guarded by `flavors_seeded_v1`). Both are called in `App.js` before rendering navigation.

**Color palette** — every screen defines a local `C` constant with the brand colors: primary `#1D9E75`, background `#F8F8F6`, card `#FFFFFF`, muted `#6B6B66`, border `#E8E8E4`, red `#E24B4A`, orange `#EF9F27`.

**`utils/format.ts`** — GNF formatting (`formatGNF`).  
**`utils/dates.ts`** — date helpers (`daysAgo`, `isToday`, `isThisWeek`, `getLast7Days`, `getDayLabel`).

## Key domain concepts

- **Flavors** (`ProductFlavor`) — product SKUs (e.g., SOL 80g). Managed in `store/flavors.ts`.
- **Bulks** (`BulkProduct`) — multi-bag bulk orders, linked to a flavor. Managed in `store/bulks.ts`.
- **Sales** — support three payment methods: `cash`, `orange_money`, `credit`. `amountPaid` tracks partial payments; `isSalePaid` / `saleDebt` helpers are in `types/index.ts`.
- **Production batches** — record potatoes used (kg), sachets produced, gas consumed, hours worked, and yield.
- **Stock** — four tracked inputs: `pommes_de_terre`, `huile`, `sachets_80g`, `gaz_lpg`. Alert thresholds are defined in `FACTORY_CONFIG.stockAlerts`. `deductStock` in `store/stock.ts` is called after production batch recording.
