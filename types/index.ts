export interface InvestmentEntry {
  id: string;
  factory_id: string;
  investorId: string;
  amount: number;
  date: string;
  notes?: string;
  createdAt?: string;
  createdBy?: string;
}

// One row per edit to a Sale or InvestmentEntry, written automatically by a
// DB trigger (see db/update15.sql) — no client code ever inserts these, and
// nothing can update or delete them once written.
export interface EditHistoryEntry<T> {
  id: string;
  editedBy?: string;
  editedAt: string;
  before: T;
  after: T;
}

// A raw-material formula: how much of each material is needed to produce
// ONE unit. Shared shape for whichever real thing gets produced — a
// ProductFlavor or a standalone BulkProduct — see "Production — produces
// directly into Saveurs/Lots" in CLAUDE.md for why this replaced a separate
// production-only product catalog.
export type RecipeLine = { rawMaterialId: string; name: string; quantity: number; unit: string };

export interface ProductFlavor {
  id: string;
  factory_id: string;
  label: string;
  weightG: number;
  defaultPrice: number;
  recipePerUnit: RecipeLine[];
}

export interface BulkProduct {
  id: string;
  factory_id: string;
  name: string;
  flavorId: string;
  bagCount: number;
  unitPrice: number;
  recipePerUnit: RecipeLine[];
}

export interface Sale {
  id: string;
  factory_id: string;
  date: string;
  clientName: string;
  product: string;
  productType?: 'flavor' | 'bulk';
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  amountPaid?: number;
  paymentMethod: 'cash' | 'orange_money' | 'credit';
  // Real cost of goods for this sale (GNF), stamped at sale time from the
  // sold item's stock_items.avg_cost — null for any sale recorded before
  // cost tracking existed. See Reports for how a null is handled.
  costAmount?: number | null;
  createdBy?: string;
}

export interface ProductionBatch {
  id: string;
  factory_id: string;
  date: string;
  potatoesUsedKg: number;
  sachets80g: number;
  gasUsedKg: number;
  hoursWorked: number;
  yieldGramsPerKg: number;
  extraMaterials?: Array<{ stockItemId: string; name: string; quantity: number; unit: string }>;
}

export interface Product {
  id: string;
  factory_id: string;
  name: string;
  unit: string;
  // Reusable formula: how much of each raw material is needed to produce
  // ONE unit of this product. Established automatically from the product's
  // first real batch, then stable — never silently rewritten by a routine
  // batch save once set. See "Production — reusable formulas" in CLAUDE.md.
  recipePerUnit: Array<{ rawMaterialId: string; name: string; quantity: number; unit: string }>;
  createdAt: string;
}

export interface Batch {
  id: string;
  factory_id: string;
  date: string;
  productId: string;
  productName: string;
  unitsProduced: number;
  materialsUsed: Array<{ rawMaterialId: string; name: string; quantity: number; unit: string }>;
  energyUsed?: number;
  hoursWorked?: number;
  notes?: string;
  createdAt: string;
  createdBy?: string;
}

export interface StockItem {
  id: string;
  factory_id: string;
  name: string;
  unit: string;
  currentLevel: number;
  alertThreshold: number;
  lastUpdated: string;
  // Weighted-average cost per unit (GNF), updated whenever stock is added
  // (a purchase, or a production batch costed from the raw materials it
  // consumed). 0 until the first purchase/batch after cost tracking began.
  avgCost?: number;
}

export interface BusinessDocument {
  id: string;
  factory_id: string;
  title: string;
  category: 'contrat' | 'facture' | 'licence' | 'import_export' | 'investisseur' | 'autre';
  fileUri: string;
  storagePath?: string; // Supabase Storage object path — resolvable from any device
  fileType: 'image' | 'pdf';
  notes: string;
  dateAdded: string;
  tags: string[];
  expirationDate?: string; // YYYY-MM-DD, used for licences
}

export interface Client {
  id: string;
  factory_id: string;
  name: string;
  phone?: string;
  location?: string;
  type?: string;
  latitude?: number;
  longitude?: number;
}

export interface Investor {
  id: string;
  factory_id: string;
  name: string;
  amountInvested: number;
  sharePercentage: number;
  dateAdded: string;
  notes?: string;
  userId?: string;
}

export const isSalePaid = (sale: Sale): boolean => {
  const paid = sale.amountPaid ?? (sale.paymentMethod !== 'credit' ? sale.totalAmount : 0);
  return paid >= sale.totalAmount;
};

export const saleDebt = (sale: Sale): number => {
  const paid = sale.amountPaid ?? (sale.paymentMethod !== 'credit' ? sale.totalAmount : 0);
  return Math.max(0, sale.totalAmount - paid);
};

export type ExpenseCategory = string;

export interface CustomCategory {
  key: string;
  label: string;
  icon: string;
}

export interface ExpenseLineItem {
  name: string;
  amount: number;
  quantity?: number;
}

// Claude (Orny's in-app AI advisor) — a real, named session (like ChatGPT's
// own conversation list), not the single ephemeral in-memory chat this used
// to be. Personal
// to (factory, user) — see db/update25.sql's RLS: even another admin of
// the same factory can't read someone else's conversation.
export interface CoachConversation {
  id: string;
  factory_id: string;
  user_id: string;
  title: string | null;
  createdAt: string;
  lastMessageAt: string;
}

export interface CoachMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  factory_id: string;
  date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod: 'cash' | 'orange_money';
  lineItems?: ExpenseLineItem[];
  deletedAt?: string;
  createdBy?: string;
  // Receipt photo — photoUri is this device's own local copy (instant
  // preview, never synced as-is since a file:// path means nothing on
  // another device); photoStoragePath is the private-bucket path every
  // factory member actually reads from. Mirrors BusinessDocument's
  // fileUri/storagePath split.
  photoUri?: string;
  photoStoragePath?: string;
}

export interface Supplier {
  id: string;
  factory_id: string;
  name: string;
  phone?: string;
  product: string;
  notes?: string;
}

export interface Purchase {
  id: string;
  factory_id: string;
  supplierId?: string;
  supplierName: string;
  date: string;
  product: string;
  stockItemId?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalAmount: number;
  amountPaid?: number;
  // Set whenever recordPurchasePayment() runs (full or partial) — lets the
  // supplier detail screen show "Dernier paiement : ..." instead of only
  // ever having the original order date to show.
  lastPaymentAt?: string;
  paymentMethod: 'cash' | 'orange_money' | 'credit';
  notes?: string;
  createdBy?: string;
}

// Mirrors isSalePaid/saleDebt exactly — same convention: an explicit
// amountPaid wins, otherwise anything but 'credit' is assumed paid in full.
export const isPurchasePaid = (purchase: Purchase): boolean => {
  const paid = purchase.amountPaid ?? (purchase.paymentMethod !== 'credit' ? purchase.totalAmount : 0);
  return paid >= purchase.totalAmount;
};

export const purchaseDebt = (purchase: Purchase): number => {
  const paid = purchase.amountPaid ?? (purchase.paymentMethod !== 'credit' ? purchase.totalAmount : 0);
  return Math.max(0, purchase.totalAmount - paid);
};

export interface InvestorDistribution {
  id: string;
  factory_id: string;
  investorId: string;
  amount: number;
  date: string;
  notes?: string;
  createdAt?: string;
  createdBy?: string;
}

export type MachineStatus = 'running' | 'idle' | 'down' | 'maintenance';

export interface Machine {
  id: string;
  factory_id: string;
  name: string;
  type: string;
  ratedCapacity: number | null;
  capacityUnit: string | null;
  status: MachineStatus;
  commissionedDate?: string;
  notes?: string;
  createdAt: string;
}

export interface MachineStatusLogEntry {
  id: string;
  factory_id: string;
  machineId: string;
  status: MachineStatus;
  reason?: string;
  createdAt: string;
}

export interface CustomerOrder {
  id: string;
  factory_id: string;
  // Every line belonging to the same client order shares one group id — a
  // legacy single-product order (or a fresh single-line one) groups to its
  // own id. See db/update26.sql for why this is a grouping column rather
  // than a normalized order_lines table.
  orderGroupId: string;
  clientName: string;
  product: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  deliveryDate: string;
  status: 'pending' | 'ready' | 'delivered' | 'cancelled';
  notes?: string;
  createdAt: string;
}

export type RootStackParamList = {
  Tabs: undefined;
  Documents: undefined;
  AddDocument: undefined;
  DocumentDetail: { document: BusinessDocument };
  Clients: undefined;
  SalesHistory: undefined;
  Investors: undefined;
  InvestorDetail: { investorId: string };
  Reports: undefined;
  Flavors: undefined;
  Bulks: undefined;
  FactorySettings: undefined;
  Coach: undefined;
  Profile: undefined;
  Expenses: undefined;
  Suppliers: undefined;
  SupplierDetail: { supplierId: string };
  CustomerOrders: { initialClientName?: string } | undefined;
  Notifications: undefined;
  Machines: undefined;
};

export type TabParamList = {
  Ventes: undefined;
  Production: undefined;
  Stock: undefined;
  Plus: undefined;
  // Investor/inspecteur-only tab — see RestrictedTabNavigator.
  Reports: undefined;
};
