// One shared source of truth for "profit" and "cash on hand" — used by both
// Dashboard and Reports so the two screens can never quietly compute a
// different number for the same thing. This app has already been bitten by
// exactly that class of bug once (see CLAUDE.md's reconciliation notes on
// the sibling Patron app) — a formula that only lives in one screen's file
// is a formula that will eventually drift from a second screen showing the
// "same" figure.
import { Sale, Expense, Purchase, InvestmentEntry, InvestorDistribution } from '../types';

export type PeriodProfit = {
  profit: number;
  revenue: number;
  cogs: number;
  otherExpenses: number;
  // 'cogs': every sale in the period carries a real stamped cost — profit
  // is exact. 'approx': at least one sale predates cost tracking (see
  // db/update15.sql), so this falls back to expensing that period's raw
  // material purchases instead — cruder, but honest about what it is,
  // never silently treats missing cost data as zero cost.
  method: 'cogs' | 'approx';
};

export function computePeriodProfit(sales: Sale[], expenses: Expense[], purchases: Purchase[]): PeriodProfit {
  const revenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const otherExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const allCosted = sales.length > 0 && sales.every((s) => s.costAmount != null);

  if (allCosted) {
    const cogs = sales.reduce((sum, s) => sum + (s.costAmount ?? 0), 0);
    return { profit: revenue - cogs - otherExpenses, revenue, cogs, otherExpenses, method: 'cogs' };
  }
  const purchaseTotal = purchases.reduce((sum, p) => sum + p.totalAmount, 0);
  return { profit: revenue - otherExpenses - purchaseTotal, revenue, cogs: purchaseTotal, otherExpenses, method: 'approx' };
}

// Real liquid position: money actually collected minus money actually paid
// out, across cash and Orange Money together (both are real business
// funds — only 'credit', money not yet collected/paid, is excluded).
// Previously "Trésorerie" was just the lifetime sum of non-credit sales
// with nothing ever subtracted — see CLAUDE.md.
export function computeCashOnHand(
  sales: Sale[],
  expenses: Expense[],
  purchases: Purchase[],
  entries: InvestmentEntry[],
  distributions: InvestorDistribution[]
): number {
  const collected = sales.reduce(
    (sum, s) => sum + (s.amountPaid ?? (s.paymentMethod !== 'credit' ? s.totalAmount : 0)),
    0
  );
  const paidToSuppliers = purchases.reduce(
    (sum, p) => sum + (p.amountPaid ?? (p.paymentMethod !== 'credit' ? p.totalAmount : 0)),
    0
  );
  const expensesOut = expenses.reduce((sum, e) => sum + e.amount, 0);
  const investedIn = entries.reduce((sum, e) => sum + e.amount, 0);
  const distributedOut = distributions.reduce((sum, d) => sum + d.amount, 0);
  return collected + investedIn - paidToSuppliers - expensesOut - distributedOut;
}
