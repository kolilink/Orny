import AsyncStorage from '@react-native-async-storage/async-storage';
import { setSales } from './sales';
import { setBatches } from './production';
import { initStock } from './stock';
import { setClients } from './clients';
import { setDocuments } from './documents';
import { setInvestors } from './investors';
import { setFlavors } from './flavors';
import { setInvestmentEntries } from './investmentEntries';
import { Sale, ProductionBatch, Client, BusinessDocument, Investor, ProductFlavor, InvestmentEntry } from '../types';
import { FACTORY_CONFIG } from '../config/factory';
import { daysAgo } from '../utils/dates';

const DEMO_KEY = 'demo_loaded_v2';
const FLAVORS_SEED_KEY = 'flavors_seeded_v1';

export const seedFlavors = async (): Promise<void> => {
  const seeded = await AsyncStorage.getItem(FLAVORS_SEED_KEY);
  if (seeded) return;
  const fid = FACTORY_CONFIG.id;
  const flavors: ProductFlavor[] = [
    { id: 'chips_nature', factory_id: fid, label: 'Chips Nature 80g', weightG: 80, defaultPrice: 15000 },
  ];
  await setFlavors(flavors);
  await AsyncStorage.setItem(FLAVORS_SEED_KEY, 'true');
};

export const loadDemoData = async (): Promise<void> => {
  const loaded = await AsyncStorage.getItem(DEMO_KEY);
  if (loaded) return;

  const fid = FACTORY_CONFIG.id;

  const flavors: ProductFlavor[] = [
    { id: 'chips_nature', factory_id: fid, label: 'Chips Nature 80g', weightG: 80, defaultPrice: 15000 },
    { id: 'chips_piment', factory_id: fid, label: 'Chips Piment 80g', weightG: 80, defaultPrice: 16000 },
  ];

  const clients: Client[] = [
    { id: 'c1', factory_id: fid, name: 'Aliou Traoré', phone: '620 00 00 01', location: 'Centre-ville', type: 'boutique' },
    { id: 'c2', factory_id: fid, name: 'Kadiatou Barry', phone: '621 00 00 02', location: 'Marché central', type: 'revendeuse marché' },
    { id: 'c3', factory_id: fid, name: 'Mamadou Kouyaté', phone: '622 00 00 03', location: 'Quartier nord', type: 'superette' },
  ];

  const sales: Sale[] = [
    { id: 's1', factory_id: fid, date: daysAgo(0), clientName: 'Aliou Traoré', product: 'chips_nature', productType: 'flavor', quantity: 30, unitPrice: 15000, totalAmount: 450000, amountPaid: 450000, paymentMethod: 'cash' },
    { id: 's2', factory_id: fid, date: daysAgo(1), clientName: 'Kadiatou Barry', product: 'chips_nature', productType: 'flavor', quantity: 20, unitPrice: 15000, totalAmount: 300000, amountPaid: 300000, paymentMethod: 'orange_money' },
    { id: 's3', factory_id: fid, date: daysAgo(2), clientName: 'Mamadou Kouyaté', product: 'chips_piment', productType: 'flavor', quantity: 50, unitPrice: 16000, totalAmount: 800000, amountPaid: 800000, paymentMethod: 'orange_money' },
    { id: 's4', factory_id: fid, date: daysAgo(4), clientName: 'Aliou Traoré', product: 'chips_nature', productType: 'flavor', quantity: 15, unitPrice: 15000, totalAmount: 225000, amountPaid: 0, paymentMethod: 'credit' },
    { id: 's5', factory_id: fid, date: daysAgo(5), clientName: 'Kadiatou Barry', product: 'chips_piment', productType: 'flavor', quantity: 40, unitPrice: 16000, totalAmount: 640000, amountPaid: 640000, paymentMethod: 'cash' },
    { id: 's6', factory_id: fid, date: daysAgo(6), clientName: 'Mamadou Kouyaté', product: 'chips_nature', productType: 'flavor', quantity: 25, unitPrice: 15000, totalAmount: 375000, amountPaid: 375000, paymentMethod: 'orange_money' },
    { id: 's7', factory_id: fid, date: daysAgo(8), clientName: 'Aliou Traoré', product: 'chips_nature', productType: 'flavor', quantity: 60, unitPrice: 15000, totalAmount: 900000, amountPaid: 900000, paymentMethod: 'cash' },
    { id: 's8', factory_id: fid, date: daysAgo(10), clientName: 'Kadiatou Barry', product: 'chips_piment', productType: 'flavor', quantity: 10, unitPrice: 16000, totalAmount: 160000, amountPaid: 160000, paymentMethod: 'cash' },
    { id: 's9', factory_id: fid, date: daysAgo(12), clientName: 'Mamadou Kouyaté', product: 'chips_nature', productType: 'flavor', quantity: 80, unitPrice: 15000, totalAmount: 1200000, amountPaid: 0, paymentMethod: 'credit' },
    { id: 's10', factory_id: fid, date: daysAgo(14), clientName: 'Aliou Traoré', product: 'chips_piment', productType: 'flavor', quantity: 35, unitPrice: 16000, totalAmount: 560000, amountPaid: 560000, paymentMethod: 'cash' },
  ];

  const batches: ProductionBatch[] = [
    { id: 'b1', factory_id: fid, date: daysAgo(0), potatoesUsedKg: 100, sachets80g: 328, gasUsedKg: 12, hoursWorked: 8, yieldGramsPerKg: 262.4 },
    { id: 'b2', factory_id: fid, date: daysAgo(1), potatoesUsedKg: 90, sachets80g: 302, gasUsedKg: 11, hoursWorked: 7, yieldGramsPerKg: 268.4 },
    { id: 'b3', factory_id: fid, date: daysAgo(7), potatoesUsedKg: 110, sachets80g: 363, gasUsedKg: 13, hoursWorked: 9, yieldGramsPerKg: 264.0 },
    { id: 'b4', factory_id: fid, date: daysAgo(10), potatoesUsedKg: 80, sachets80g: 262, gasUsedKg: 10, hoursWorked: 6, yieldGramsPerKg: 262.5 },
  ];

  const investors: Investor[] = [
    {
      id: 'inv1', factory_id: fid, name: 'Alpha Diallo',
      amountInvested: 50000000, sharePercentage: 30,
      dateAdded: new Date(Date.now() - 90 * 86400000).toISOString(),
      notes: 'Investisseur principal. Versement initial.',
    },
    {
      id: 'inv2', factory_id: fid, name: 'Mariama Camara',
      amountInvested: 20000000, sharePercentage: 15,
      dateAdded: new Date(Date.now() - 60 * 86400000).toISOString(),
      notes: '',
    },
  ];

  const investmentEntries: InvestmentEntry[] = [
    {
      id: 'ie1', factory_id: fid, investorId: 'inv1',
      amount: 10000000,
      date: daysAgo(30),
      notes: 'Deuxième versement',
    },
  ];

  const documents: BusinessDocument[] = [
    {
      id: 'd1', factory_id: fid,
      title: 'Contrat fournisseur — emballages',
      category: 'import_export', fileUri: 'placeholder:#4A90D9', fileType: 'image',
      notes: 'Accord annuel avec le fournisseur d\'emballages. Renouvellement en janvier.',
      dateAdded: new Date(Date.now() - 30 * 86400000).toISOString(),
      tags: ['emballages', 'fournisseur'],
    },
    {
      id: 'd2', factory_id: fid,
      title: 'Licence de production',
      category: 'licence', fileUri: 'placeholder:#27AE60', fileType: 'pdf',
      notes: 'Licence officielle de production alimentaire.',
      dateAdded: new Date(Date.now() - 60 * 86400000).toISOString(),
      tags: ['licence', 'officiel'],
    },
    {
      id: 'd3', factory_id: fid,
      title: 'Accord investisseur — Versement initial',
      category: 'investisseur', fileUri: 'placeholder:#8E44AD', fileType: 'pdf',
      notes: 'Accord signé pour le versement initial de 50 000 000 GNF.',
      dateAdded: new Date(Date.now() - 90 * 86400000).toISOString(),
      tags: ['investisseur'],
    },
  ];

  await Promise.all([
    setFlavors(flavors),
    setClients(clients),
    setSales(sales),
    setBatches(batches),
    initStock({ pommes_de_terre: 35, huile: 28, sachets_80g: 620, gaz_lpg: 8 }),
    setDocuments(documents),
    setInvestors(investors),
    setInvestmentEntries(investmentEntries),
  ]);

  await AsyncStorage.setItem(DEMO_KEY, 'true');
  await AsyncStorage.setItem(FLAVORS_SEED_KEY, 'true');
};
