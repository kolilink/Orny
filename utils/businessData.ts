import { getSales } from '../store/sales';
import { getBatches } from '../store/production';
import { getStock } from '../store/stock';
import { getInvestors } from '../store/investors';
import { getWeeklyTarget } from '../store/weeklyTarget';
import { saleDebt } from '../types';
import { isThisWeek, daysAgo, toDateString } from './dates';

function getMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function isThisMonth(dateStr: string): boolean {
  return dateStr >= getMonthStart() && dateStr <= toDateString();
}

function safePct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

export interface StockSnapshot {
  name: string;
  currentLevel: number;
  alertThreshold: number;
  unit: string;
  status: 'ok' | 'low' | 'critical';
}

export interface BusinessSnapshot {
  generatedAt: string;

  sales: {
    today: { count: number; revenue: number; collected: number; debt: number };
    week: { count: number; revenue: number; collected: number; debt: number; topClient: string };
    month: { count: number; revenue: number; collected: number; debt: number };
    allTime: { totalRevenue: number; totalDebt: number; collectionRate: number };
    paymentMix: { cash: number; orangeMoney: number; credit: number };
    avgTransactionValue: number;
    topDebtors: Array<{ name: string; debt: number }>;
    topClients: Array<{ name: string; revenue: number }>;
  };

  production: {
    today: { batches: number; sachets: number; potatoesKg: number; hours: number };
    week: { batches: number; sachets: number; potatoesKg: number; hours: number; avgYield: number };
    month: { batches: number; sachets: number };
    weeklyTarget: number;
    weeklyProgress: number;
    avgYieldGPerKg: number;
    productionCoverage: number;
  };

  stock: {
    items: StockSnapshot[];
    lowCount: number;
    criticalNames: string[];
  };

  financial: {
    totalCapitalInvested: number;
    estimatedRevenueLast30d: number;
    cashReceivedLast30d: number;
    outstandingDebt: number;
    collectionRate30d: number;
    revenuePerBatch: number;
  };
}

export async function getBusinessSnapshot(): Promise<BusinessSnapshot> {
  const [sales, batches, stock, investors, weeklyTarget] = await Promise.all([
    getSales(),
    getBatches(),
    getStock(),
    getInvestors(),
    getWeeklyTarget(),
  ]);

  const today = toDateString();
  const monthStart = getMonthStart();
  const day30Ago = daysAgo(30);

  const todaySales = sales.filter(s => s.date === today);
  const weekSales = sales.filter(s => isThisWeek(s.date));
  const monthSales = sales.filter(s => isThisMonth(s.date));
  const last30Sales = sales.filter(s => s.date >= day30Ago && s.date <= today);

  const sumRevenue = (arr: typeof sales) => arr.reduce((a, s) => a + s.totalAmount, 0);
  const sumCollected = (arr: typeof sales) =>
    arr.reduce((a, s) => {
      const paid = s.amountPaid ?? (s.paymentMethod !== 'credit' ? s.totalAmount : 0);
      return a + Math.min(paid, s.totalAmount);
    }, 0);
  const sumDebt = (arr: typeof sales) => arr.reduce((a, s) => a + saleDebt(s), 0);

  const totalRevenue = sumRevenue(sales);
  const cashRevenue = sales
    .filter(s => s.paymentMethod === 'cash')
    .reduce((a, s) => a + s.totalAmount, 0);
  const omRevenue = sales
    .filter(s => s.paymentMethod === 'orange_money')
    .reduce((a, s) => a + s.totalAmount, 0);
  const creditRevenue = sales
    .filter(s => s.paymentMethod === 'credit')
    .reduce((a, s) => a + s.totalAmount, 0);

  const clientMap: Record<string, { revenue: number }> = {};
  weekSales.forEach(s => {
    if (!clientMap[s.clientName]) clientMap[s.clientName] = { revenue: 0 };
    clientMap[s.clientName].revenue += s.totalAmount;
  });
  const topClients = Object.entries(clientMap)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 3)
    .map(([name, v]) => ({ name, revenue: v.revenue }));
  const topClient = topClients[0]?.name ?? 'Aucun';

  const debtorMap: Record<string, number> = {};
  sales.forEach(s => {
    const debt = saleDebt(s);
    if (debt > 0) debtorMap[s.clientName] = (debtorMap[s.clientName] ?? 0) + debt;
  });
  const topDebtors = Object.entries(debtorMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, debt]) => ({ name, debt }));

  const todayBatches = batches.filter(b => b.date === today);
  const weekBatches = batches.filter(b => isThisWeek(b.date));
  const monthBatches = batches.filter(b => isThisMonth(b.date));

  const sumSachets = (arr: typeof batches) => arr.reduce((a, b) => a + b.sachets80g, 0);
  const sumPotatoesKg = (arr: typeof batches) => arr.reduce((a, b) => a + b.potatoesUsedKg, 0);
  const sumHours = (arr: typeof batches) => arr.reduce((a, b) => a + b.hoursWorked, 0);

  const allYields = batches.filter(b => b.yieldGramsPerKg > 0).map(b => b.yieldGramsPerKg);
  const avgYield =
    allYields.length > 0
      ? Math.round(allYields.reduce((a, v) => a + v, 0) / allYields.length)
      : 0;

  const weekYields = weekBatches.filter(b => b.yieldGramsPerKg > 0).map(b => b.yieldGramsPerKg);
  const weekAvgYield =
    weekYields.length > 0
      ? Math.round(weekYields.reduce((a, v) => a + v, 0) / weekYields.length)
      : avgYield;

  const weekSachets = sumSachets(weekBatches);
  const weekSalesUnits = weekSales.reduce((a, s) => a + s.quantity, 0);
  const productionCoverage = weekSalesUnits > 0 ? safePct(weekSachets, weekSalesUnits) : 100;

  const stockItems: StockSnapshot[] = stock.map(item => {
    let status: 'ok' | 'low' | 'critical' = 'ok';
    if (item.currentLevel <= 0) status = 'critical';
    else if (item.currentLevel <= item.alertThreshold) status = 'low';
    return {
      name: item.name,
      currentLevel: item.currentLevel,
      alertThreshold: item.alertThreshold,
      unit: item.unit,
      status,
    };
  });

  const weekRevenue = sumRevenue(weekSales);
  const weekBatchCount = weekBatches.length;
  const allTimeRevenue = sumRevenue(sales);
  const allTimeDebt = sumDebt(sales);
  const allTimeCollected = sumCollected(sales);
  const rev30 = sumRevenue(last30Sales);
  const cash30 = sumCollected(last30Sales);

  return {
    generatedAt: new Date().toISOString(),

    sales: {
      today: {
        count: todaySales.length,
        revenue: sumRevenue(todaySales),
        collected: sumCollected(todaySales),
        debt: sumDebt(todaySales),
      },
      week: {
        count: weekSales.length,
        revenue: weekRevenue,
        collected: sumCollected(weekSales),
        debt: sumDebt(weekSales),
        topClient,
      },
      month: {
        count: monthSales.length,
        revenue: sumRevenue(monthSales),
        collected: sumCollected(monthSales),
        debt: sumDebt(monthSales),
      },
      allTime: {
        totalRevenue: allTimeRevenue,
        totalDebt: allTimeDebt,
        collectionRate: safePct(allTimeCollected, allTimeRevenue),
      },
      paymentMix: {
        cash: safePct(cashRevenue, totalRevenue),
        orangeMoney: safePct(omRevenue, totalRevenue),
        credit: safePct(creditRevenue, totalRevenue),
      },
      avgTransactionValue:
        weekSales.length > 0 ? Math.round(weekRevenue / weekSales.length) : 0,
      topDebtors,
      topClients,
    },

    production: {
      today: {
        batches: todayBatches.length,
        sachets: sumSachets(todayBatches),
        potatoesKg: sumPotatoesKg(todayBatches),
        hours: sumHours(todayBatches),
      },
      week: {
        batches: weekBatchCount,
        sachets: weekSachets,
        potatoesKg: sumPotatoesKg(weekBatches),
        hours: sumHours(weekBatches),
        avgYield: weekAvgYield,
      },
      month: {
        batches: monthBatches.length,
        sachets: sumSachets(monthBatches),
      },
      weeklyTarget,
      weeklyProgress: safePct(weekSachets, weeklyTarget),
      avgYieldGPerKg: avgYield,
      productionCoverage,
    },

    stock: {
      items: stockItems,
      lowCount: stockItems.filter(s => s.status !== 'ok').length,
      criticalNames: stockItems.filter(s => s.status === 'critical').map(s => s.name),
    },

    financial: {
      totalCapitalInvested: investors.reduce((a, inv) => a + inv.amountInvested, 0),
      estimatedRevenueLast30d: rev30,
      cashReceivedLast30d: cash30,
      outstandingDebt: allTimeDebt,
      collectionRate30d: safePct(cash30, rev30),
      revenuePerBatch: weekBatchCount > 0 ? Math.round(weekRevenue / weekBatchCount) : 0,
    },
  };
}
