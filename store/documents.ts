import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { BusinessDocument } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_documents`; }
const DOCS_DIR = (FileSystem.documentDirectory ?? '') + 'sol_docs/';

export const getDocuments = async (): Promise<BusinessDocument[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as BusinessDocument[]) : [];
};

const setCache = async (docs: BusinessDocument[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(docs));
};

export const syncDocumentsFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('business_documents')
    .select('*')
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: false });
  if (error || !data) return;
  // Only update metadata for docs that already exist locally (file URIs are device-local)
  const existing = await getDocuments();
  const existingById = Object.fromEntries(existing.map((d) => [d.id, d]));
  const merged: BusinessDocument[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    title: r.title,
    category: r.category,
    fileUri: existingById[r.id]?.fileUri ?? r.file_uri,
    fileType: r.file_type,
    notes: r.notes,
    dateAdded: r.date_added,
    tags: r.tags,
    expirationDate: r.expiration_date,
  }));
  await setCache(merged);
};

export const addDocument = async (
  doc: Omit<BusinessDocument, 'id' | 'factory_id' | 'dateAdded' | 'fileUri'>,
  sourceUri: string
): Promise<BusinessDocument> => {
  const factoryId = getFactoryId();
  const id = generateId();
  let finalUri = sourceUri;

  if (!sourceUri.startsWith('placeholder:')) {
    try {
      const dirInfo = await FileSystem.getInfoAsync(DOCS_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(DOCS_DIR, { intermediates: true });
      }
      const ext = doc.fileType === 'pdf' ? 'pdf' : 'jpg';
      const destUri = DOCS_DIR + id + '.' + ext;
      await FileSystem.copyAsync({ from: sourceUri, to: destUri });
      finalUri = destUri;
    } catch {
      finalUri = sourceUri;
    }
  }

  const newDoc: BusinessDocument = {
    ...doc,
    id,
    factory_id: factoryId,
    fileUri: finalUri,
    dateAdded: new Date().toISOString(),
  };

  const docs = await getDocuments();
  await setCache([newDoc, ...docs]);

  // Sync metadata only (files stay on device)
  supabase.from('business_documents').insert({
    id: newDoc.id,
    factory_id: factoryId,
    title: newDoc.title,
    category: newDoc.category,
    file_uri: newDoc.fileUri,
    file_type: newDoc.fileType,
    notes: newDoc.notes,
    date_added: newDoc.dateAdded,
    tags: newDoc.tags,
    expiration_date: newDoc.expirationDate ?? null,
  }).then(({ error }) => { if (error) console.warn('documents insert sync error', error.message); });

  return newDoc;
};

export const setDocuments = async (docs: BusinessDocument[]): Promise<void> => {
  await setCache(docs);
};
