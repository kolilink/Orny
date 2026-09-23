import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { BusinessDocument } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/withTimeout';

function cacheKey() { return `${getFactoryId()}_documents`; }
const DOCS_DIR = (FileSystem.documentDirectory ?? '') + 'sol_docs/';
const BUCKET = 'business-documents';

// Signed URLs (bucket is private) so the file is viewable from any device,
// not just the one that originally uploaded it. Short-lived by design —
// callers should fetch a fresh one right before displaying/opening a file.
export const getSignedDocumentUrl = async (storagePath: string): Promise<string | null> => {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (error || !data) return null;
  return data.signedUrl;
};

export const getDocuments = async (): Promise<BusinessDocument[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as BusinessDocument[]) : [];
};

const setCache = async (docs: BusinessDocument[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(docs));
};

export const syncDocumentsFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.from('business_documents').select('*').eq('factory_id', factoryId).order('created_at', { ascending: false })
    ));
  } catch {
    return;
  }
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
    storagePath: r.storage_path ?? undefined,
    fileType: r.file_type,
    notes: r.notes,
    dateAdded: r.date_added,
    tags: r.tags,
    expirationDate: r.expiration_date,
  }));
  await setCache(merged);
};

export const addDocument = async (
  doc: Omit<BusinessDocument, 'id' | 'factory_id' | 'dateAdded' | 'fileUri' | 'storagePath'>,
  sourceUri: string
): Promise<BusinessDocument> => {
  const factoryId = getFactoryId();
  const id = generateId();
  let finalUri = sourceUri;
  let storagePath: string | undefined;

  if (!sourceUri.startsWith('placeholder:')) {
    const ext = doc.fileType === 'pdf' ? 'pdf' : 'jpg';
    const contentType = doc.fileType === 'pdf' ? 'application/pdf' : 'image/jpeg';
    const path = `${factoryId}/${id}.${ext}`;

    if (Platform.OS === 'web') {
      // expo-file-system/legacy is a no-op shim on web (no real filesystem to
      // copy into or read a base64 string from — every method call above
      // would throw) — sourceUri here is always a data: URL from a <input
      // type=file> FileReader read (see AddDocument.tsx's webPickFromDisk),
      // which fetch() can turn into a real Blob directly, no FileSystem
      // needed at all. Without this branch, every document added from the
      // PWA silently kept only its metadata row — the file itself was never
      // actually uploaded, so it vanished the moment this browser's local
      // state was cleared and never existed for any other device to see.
      finalUri = sourceUri;
      try {
        const blob = await (await fetch(sourceUri)).blob();
        const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType });
        if (error) throw error;
        storagePath = path;
      } catch (e) {
        console.warn('document storage upload error (web)', e);
      }
    } else {
      // Local copy — instant preview on this device without a network round trip.
      try {
        const dirInfo = await FileSystem.getInfoAsync(DOCS_DIR);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(DOCS_DIR, { intermediates: true });
        }
        const destUri = DOCS_DIR + id + '.' + ext;
        await FileSystem.copyAsync({ from: sourceUri, to: destUri });
        finalUri = destUri;
      } catch {
        finalUri = sourceUri;
      }

      // Real upload — this is what makes the file recoverable if this device
      // is lost/reinstalled, and visible to every other member of the factory.
      try {
        const base64 = await FileSystem.readAsStringAsync(sourceUri, { encoding: 'base64' });
        const { error } = await supabase.storage.from(BUCKET).upload(path, decode(base64), { contentType });
        if (error) throw error;
        storagePath = path;
      } catch (e) {
        console.warn('document storage upload error', e);
      }
    }
  }

  const newDoc: BusinessDocument = {
    ...doc,
    id,
    factory_id: factoryId,
    fileUri: finalUri,
    storagePath,
    dateAdded: new Date().toISOString(),
  };

  const docs = await getDocuments();
  await setCache([newDoc, ...docs]);

  // Awaited — a fire-and-forget insert here races a caller's immediate
  // post-add reload/re-sync and can lose the new document from view even
  // though it lands fine in Postgres (same bug reproduced and fixed for
  // store/investors.ts's addInvestor).
  const { error } = await supabase.from('business_documents').insert({
    id: newDoc.id,
    factory_id: factoryId,
    title: newDoc.title,
    category: newDoc.category,
    file_uri: newDoc.fileUri,
    storage_path: newDoc.storagePath ?? null,
    file_type: newDoc.fileType,
    notes: newDoc.notes,
    date_added: newDoc.dateAdded,
    tags: newDoc.tags,
    expiration_date: newDoc.expirationDate ?? null,
  });
  if (error) console.warn('documents insert sync error', error.message);

  return newDoc;
};

export const setDocuments = async (docs: BusinessDocument[]): Promise<void> => {
  await setCache(docs);
};
