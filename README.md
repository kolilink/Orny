# Orny — SOL Chips Factory Manager

A React Native (Expo) mobile app for managing **SOL Chips**, a small chip factory in Conakry, Guinea. The app is fully offline, running entirely on-device with no backend. The UI and all data labels are in French. Currency is GNF (Guinean Franc).

## Features

- **Dashboard** — daily sales summary, production overview, stock alerts, and weekly target tracking
- **Ventes (Sales)** — record sales by flavor, supporting cash, Orange Money, and credit payment methods with partial-payment tracking
- **Production** — log production batches (potatoes used, sachets produced, gas, hours, yield)
- **Stock** — track four key inputs (potatoes, oil, sachets, LPG gas) with configurable alert thresholds
- **Clients** — manage client profiles and their credit balances
- **Investors** — track investors and their investment entries
- **Documents** — attach and store business documents (images, PDFs)
- **Reports** — view historical sales and production reports
- **Flavors & Bulks** — manage product SKUs (e.g., SOL 80g) and bulk/multi-bag orders

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React Native via [Expo](https://expo.dev) ~54 |
| Language | TypeScript |
| Navigation | React Navigation (Stack + Bottom Tabs) |
| Storage | `@react-native-async-storage/async-storage` (local, no backend) |

## Project Structure

```
├── App.js                  # Entry point; seeds demo data, mounts navigation
├── config/factory.ts       # Factory identity, currency, production targets, stock alert thresholds
├── types/index.ts          # All shared interfaces and navigation param lists
├── navigation/index.tsx    # Root Stack + Bottom Tab navigator
├── screens/                # One folder per screen/feature
│   ├── Dashboard/
│   ├── Ventes/
│   ├── Production/
│   ├── Stock/
│   ├── Clients/
│   ├── Investors/
│   ├── Documents/
│   ├── Reports/
│   ├── Flavors/
│   ├── Bulks/
│   └── Plus/
├── store/                  # Async CRUD modules (one per entity)
│   ├── sales.ts
│   ├── production.ts
│   ├── stock.ts
│   ├── clients.ts
│   ├── investors.ts
│   ├── investmentEntries.ts
│   ├── documents.ts
│   ├── flavors.ts
│   ├── bulks.ts
│   ├── weeklyTarget.ts
│   └── demo.ts             # Demo data seeder (runs once on first launch)
└── utils/
    ├── format.ts           # GNF currency formatter
    └── dates.ts            # Date helpers (daysAgo, isToday, isThisWeek, etc.)
```

## Getting Started

### Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- iOS Simulator (macOS) or Android Emulator, or the Expo Go app on a physical device

### Install & Run

```bash
npm install

# Start dev server (choose platform interactively)
npx expo start

# Or target a platform directly
npx expo start --ios
npx expo start --android
```

### Type Check

```bash
npx tsc --noEmit
```

## Data & Storage

All data is persisted locally using AsyncStorage. There is no backend, no network layer, and no authentication. Every AsyncStorage key is namespaced by the factory `id` defined in `config/factory.ts`.

On first launch, `store/demo.ts` seeds sample sales, production, stock, client, and investor data so the app is immediately explorable.

## Color Palette

| Token | Value |
|---|---|
| Primary | `#1D9E75` |
| Background | `#F8F8F6` |
| Card | `#FFFFFF` |
| Muted | `#6B6B66` |
| Border | `#E8E8E4` |
| Red | `#E24B4A` |
| Orange | `#EF9F27` |
