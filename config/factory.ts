export const FACTORY_CONFIG = {
  id: 'sol_conakry',
  name: 'SOL Chips',
  currency: 'GNF',
  weeklyProductionTarget: 1000,
  products: [
    { id: 'SOL_80g', label: 'SOL 80g', weightG: 80, defaultPrice: 15000 },
  ],
  stockAlerts: {
    pommes_de_terre: { unit: 'kg', threshold: 50 },
    huile: { unit: 'L', threshold: 20 },
    sachets_80g: { unit: 'unités', threshold: 500 },
    gaz_lpg: { unit: 'kg', threshold: 10 },
  },
} as const;

export type FactoryConfig = typeof FACTORY_CONFIG;
