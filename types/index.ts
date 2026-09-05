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

export interface ProductFlavor {
  id: string;
  factory_id: string;
  label: string;
  weightG: number;
  defaultPrice: number;
}

export interface BulkProduct {
  id: string;
  factory_id: string;
  name: string;
  flavorId: string;
  bagCount: number;
  unitPrice: number;
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
  lastRecipe: Array<{ rawMaterialId: string; name: string; quantity: number; unit: string }>;
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
  Investors: undefined;
  Reports: undefined;
  Flavors: undefined;
  Bulks: undefined;
  FactorySettings: undefined;
  Coach: undefined;
  Profile: undefined;
  Expenses: undefined;
  Suppliers: undefined;
  CustomerOrders: { initialClientName?: string } | undefined;
  Notifications: undefined;
  Machines: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Ventes: undefined;
  Production: undefined;
  Stock: undefined;
  Plus: undefined;
};
