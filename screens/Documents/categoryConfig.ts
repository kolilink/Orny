import { BusinessDocument } from '../../types';
import { Palette } from '../../theme/tokens';

// Was copy-pasted verbatim between index.tsx and DocumentDetail.tsx — one
// shared source of truth instead.
export const CATEGORIES: { key: BusinessDocument['category'] | 'all'; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'contrat', label: 'Contrats' },
  { key: 'facture', label: 'Factures' },
  { key: 'licence', label: 'Licences' },
  { key: 'import_export', label: 'Import/Export' },
  { key: 'investisseur', label: 'Investisseurs' },
  { key: 'autre', label: 'Autres' },
];

export const CAT_LABELS: Record<BusinessDocument['category'], string> = {
  contrat: 'Contrat',
  facture: 'Facture',
  licence: 'Licence',
  import_export: 'Import/Export',
  investisseur: 'Investisseur',
  autre: 'Autre',
};

export const makeCatColors = (palette: Palette): Record<BusinessDocument['category'], { bg: string; text: string }> => ({
  contrat: { bg: palette.infoSoft, text: palette.infoDeep },
  facture: { bg: palette.cautionSoft, text: palette.caution },
  licence: { bg: palette.mossSoft, text: palette.mossDeep },
  import_export: { bg: palette.tealSoft, text: palette.tealDeep },
  investisseur: { bg: palette.violetSoft, text: palette.violetDeep },
  autre: { bg: palette.line, text: palette.muted },
});
