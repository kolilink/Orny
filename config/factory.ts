export const FACTORY_CONFIG = {
  id: 'orny_main',
  name: 'Orny',
  currency: 'GNF',
  weeklyProductionTarget: 1000,
  products: [] as { id: string; label: string; weightG: number; defaultPrice: number }[],
  stockAlerts: {
    pommes_de_terre: { unit: 'kg', threshold: 50 },
    huile: { unit: 'L', threshold: 20 },
    sachets_80g: { unit: 'unités', threshold: 500 },
    gaz_lpg: { unit: 'kg', threshold: 10 },
  },
} as const;

export type FactoryConfig = typeof FACTORY_CONFIG;
