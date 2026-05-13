import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { BusinessDocument } from '../types';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_documents`;
const DOCS_DIR = (FileSystem.documentDirectory ?? '') + 'sol_docs/';

export const getDocuments = async (): Promise<BusinessDocument[]> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? (JSON.parse(data) as BusinessDocument[]) : [];
};

export const addDocument = async (
  doc: Omit<BusinessDocument, 'id' | 'factory_id' | 'dateAdded' | 'fileUri'>,
  sourceUri: string
): Promise<BusinessDocument> => {
  const id = Date.now().toString();
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
    factory_id: FACTORY_CONFIG.id,
    fileUri: finalUri,
    dateAdded: new Date().toISOString(),
  };

  const docs = await getDocuments();
  await AsyncStorage.setItem(KEY, JSON.stringify([newDoc, ...docs]));
  return newDoc;
};

export const setDocuments = async (docs: BusinessDocument[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(docs));
};
