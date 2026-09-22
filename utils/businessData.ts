import { getSales } from '../store/sales';
import { getBatches } from '../store/batches';
import { getStock } from '../store/stock';
import { getInvestors } from '../store/investors';
import { getExpenses } from '../store/expenses';
import { getWeeklyTarget } from '../store/weeklyTarget';
import { getMachines } from '../store/machines';
import { saleDebt } from '../types';
import { isThisWeek, isLastWeek, daysAgo, toDateString } from './dates';
import { computeRunrates } from './runrate';
import { stockSeverity } from './stockAlerts';

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
  dailyConsumption: number;
  daysOfCover: number | null;
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
    today: { batches: number; unitsProduced: number; hours: number };
    week: { batches: number; unitsProduced: number; hours: number };
    month: { batches: number; unitsProduced: number };
    weeklyTarget: number;
    weeklyProgress: number;
    productionCoverage: number;
    topProducts: Array<{ name: string; unitsProduced: number }>;
    materialsConsumedWeek: Array<{ name: string; quantity: number; unit: string }>;
  };

  stock: {
    items: StockSnapshot[];
    lowCount: number;
    criticalNames: string[];
  };

  // Empty until the factory actually enters machines (screens/Machines/) —
  // present from day one so Claude picks it up automatically the moment
  // real data exists, with no further code changes needed.
  machines: {
    total: number;
    running: number;
    down: number;
    maintenance: number;
    idle: number;
    items: Array<{ name: string; type: string; status: string; ratedCapacity: number | null; capacityUnit: string | null }>;
  };

  financial: {
    totalCapitalInvested: number;
    estimatedRevenueLast30d: number;
    cashReceivedLast30d: number;
    outstandingDebt: number;
    collectionRate30d: number;
    revenuePerBatch: number;
    expensesThisMonth: number;
    netProfitThisMonth: number;
  };

  // This week vs. the calendar week immediately before it — a flat
  // snapshot can't tell Claude whether "50 000 GNF today" is a good or
  // bad number; a real trend can. null (not 0) when last week had nothing
  // to compare against, so the AI reads "no baseline" rather than a
  // misleading "-100%".
  trend: {
    revenueVsLastWeekPct: number | null;
    unitsProducedVsLastWeekPct: number | null;
  };
}

export async function getBusinessSnapshot(): Promise<BusinessSnapshot> {
  const [sales, batches, stock, investors, weeklyTarget, expenses, machines] = await Promise.all([
    getSales(),
    getBatches(),
    getStock(),
    getInvestors(),
    getWeeklyTarget(),
    getExpenses(),
    getMachines(),
  ]);

  const today = toDateString();
  const monthStart = getMonthStart();
  const day30Ago = daysAgo(30);

  const todaySales = sales.filter(s => s.date === today);
  const weekSales = sales.filter(s => isThisWeek(s.date));
  const lastWeekSales = sales.filter(s => isLastWeek(s.date));
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
  const lastWeekBatches = batches.filter(b => isLastWeek(b.date));
  const monthBatches = batches.filter(b => isThisMonth(b.date));

  const sumUnits = (arr: typeof batches) => arr.reduce((a, b) => a + b.unitsProduced, 0);
  const sumHours = (arr: typeof batches) => arr.reduce((a, b) => a + (b.hoursWorked ?? 0), 0);

  const weekUnits = sumUnits(weekBatches);
  const weekSalesUnits = weekSales.reduce((a, s) => a + s.quantity, 0);
  const productionCoverage = weekSalesUnits > 0 ? safePct(weekUnits, weekSalesUnits) : 100;

  // Per-product breakdown (generic — Production no longer assumes a single
  // potato→sachet recipe; each batch names its own product).
  const productMap: Record<string, number> = {};
  weekBatches.forEach(b => {
    productMap[b.productName] = (productMap[b.productName] ?? 0) + b.unitsProduced;
  });
  const topProducts = Object.entries(productMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, unitsProduced]) => ({ name, unitsProduced }));

  // Raw materials consumed this week, grouped by name+unit (materials are
  // arbitrary per-recipe now, so quantities can only be summed within the
  // same unit — this is also the input the inventory runrate calc reuses).
  const materialMap: Record<string, { quantity: number; unit: string }> = {};
  weekBatches.forEach(b => {
    (b.materialsUsed ?? []).forEach(m => {
      const key = `${m.name}__${m.unit}`;
      if (!materialMap[key]) materialMap[key] = { quantity: 0, unit: m.unit };
      materialMap[key].quantity += m.quantity;
    });
  });
  const materialsConsumedWeek = Object.entries(materialMap)
    .map(([key, v]) => ({ name: key.split('__')[0], quantity: v.quantity, unit: v.unit }))
    .sort((a, b) => b.quantity - a.quantity);

  const runrateById = new Map(computeRunrates(stock, batches, sales).map(r => [r.id, r]));

  const stockItems: StockSnapshot[] = stock.map(item => {
    const status = stockSeverity(item.currentLevel, item.alertThreshold);
    const runrate = runrateById.get(item.id);
    return {
      name: item.name,
      currentLevel: item.currentLevel,
      alertThreshold: item.alertThreshold,
      unit: item.unit,
      status,
      dailyConsumption: runrate?.dailyConsumption ?? 0,
      daysOfCover: runrate?.daysOfCover ?? null,
    };
  });

  const machineSnapshot = {
    total: machines.length,
    running: machines.filter(m => m.status === 'running').length,
    down: machines.filter(m => m.status === 'down').length,
    maintenance: machines.filter(m => m.status === 'maintenance').length,
    idle: machines.filter(m => m.status === 'idle').length,
    items: machines.map(m => ({
      name: m.name,
      type: m.type,
      status: m.status,
      ratedCapacity: m.ratedCapacity,
      capacityUnit: m.capacityUnit,
    })),
  };

  const weekRevenue = sumRevenue(weekSales);
  const lastWeekRevenue = sumRevenue(lastWeekSales);
  const weekUnitsForTrend = sumUnits(weekBatches);
  const lastWeekUnits = sumUnits(lastWeekBatches);
  const revenueVsLastWeekPct = lastWeekRevenue > 0
    ? Math.round(((weekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100)
    : null;
  const unitsProducedVsLastWeekPct = lastWeekUnits > 0
    ? Math.round(((weekUnitsForTrend - lastWeekUnits) / lastWeekUnits) * 100)
    : null;
  const weekBatchCount = weekBatches.length;
  const allTimeRevenue = sumRevenue(sales);
  const allTimeDebt = sumDebt(sales);
  const allTimeCollected = sumCollected(sales);
  const rev30 = sumRevenue(last30Sales);
  const cash30 = sumCollected(last30Sales);

  const monthExpenses = expenses.filter(e => isThisMonth(e.date)).reduce((a, e) => a + e.amount, 0);
  const monthRevenue = sumRevenue(monthSales);
  const netProfitThisMonth = monthRevenue - monthExpenses;

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
        unitsProduced: sumUnits(todayBatches),
        hours: sumHours(todayBatches),
      },
      week: {
        batches: weekBatchCount,
        unitsProduced: weekUnits,
        hours: sumHours(weekBatches),
      },
      month: {
        batches: monthBatches.length,
        unitsProduced: sumUnits(monthBatches),
      },
      weeklyTarget,
      weeklyProgress: safePct(weekUnits, weeklyTarget),
      productionCoverage,
      topProducts,
      materialsConsumedWeek,
    },

    stock: {
      items: stockItems,
      lowCount: stockItems.filter(s => s.status !== 'ok').length,
      criticalNames: stockItems.filter(s => s.status === 'critical').map(s => s.name),
    },

    machines: machineSnapshot,

    financial: {
      totalCapitalInvested: investors.reduce((a, inv) => a + inv.amountInvested, 0),
      estimatedRevenueLast30d: rev30,
      cashReceivedLast30d: cash30,
      outstandingDebt: allTimeDebt,
      collectionRate30d: safePct(cash30, rev30),
      revenuePerBatch: weekBatchCount > 0 ? Math.round(weekRevenue / weekBatchCount) : 0,
      expensesThisMonth: monthExpenses,
      netProfitThisMonth,
    },

    trend: {
      revenueVsLastWeekPct,
      unitsProducedVsLastWeekPct,
    },
  };
}
