export interface InvestmentEntry {
  id: string;
  factory_id: string;
  investorId: string;
  amount: number;
  date: string;
  notes?: string;
  createdAt?: string;
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

export interface StockItem {
  id: string;
  factory_id: string;
  name: string;
  unit: string;
  currentLevel: number;
  alertThreshold: number;
  lastUpdated: string;
}

export interface BusinessDocument {
  id: string;
  factory_id: string;
  title: string;
  category: 'contrat' | 'facture' | 'licence' | 'import_export' | 'investisseur' | 'autre';
  fileUri: string;
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
  quantity: number;
  unit: string;
  unitPrice: number;
  totalAmount: number;
  paymentMethod: 'cash' | 'orange_money' | 'credit';
  notes?: string;
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
  CustomerOrders: undefined;
  Creances: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Ventes: undefined;
  Production: undefined;
  Stock: undefined;
  Plus: undefined;
};
