import { TextStyle } from 'react-native';

// Shared design tokens — the single source of truth for color, type,
// spacing, radius, and elevation. Adopted app-wide (design pass, 2026-07-16):
// screens no longer define a local `C` constant per file.
//
// Palette notes (revised 2026-09-05 — "make it feel alive, international,
// zero effort to process," benchmarked directly against Robinhood and
// Patron screenshots):
// - The original palette here was warm on purpose — cream paper (#F6F4EF),
//   warm beige lines, muted brown/rust for caution/critical — a deliberate
//   "artisanal, don't shout" choice. Against real Robinhood/Patron
//   screenshots side by side, that warmth is exactly what read as flat/
//   sleepy rather than alive: both references use cool, near-neutral
//   backgrounds (pure white or a barely-there cool gray) and let contrast
//   and one saturated accent color do the work.
// - `moss` keeps its identity as the one brand accent (green still fits a
//   production/factory app) but moves from a muted forest tone to a real
//   saturated signal green (Tailwind's "emerald" scale — extensively
//   tested, used everywhere from fintech to enterprise SaaS, not a novel
//   pick). Contrast against a now-neutral background is what makes it pop;
//   the old muted background made even a stronger green look quiet.
// - `caution` / `critical` move from custom muted rust/amber tones to real
//   amber and red. This is a direct reversal of the original "don't make
//   bad news feel scary, stay warm/muted" call, made deliberately: the
//   actual brief this time is "zero cognitive effort" — and real amber/red
//   ARE the zero-effort choice, since they're universally pre-learned
//   (nobody has to figure out what a custom rust tone means), whereas a
//   clever muted reinterpretation is itself a small tax on every reader.
//   Still two real severity steps (see the two-step-gradient screens listed
//   below), just with conventional colors instead of invented ones.
export const paletteLight = {
  ink: '#0F1115',
  paper: '#F7F8FA',
  card: '#FFFFFF',
  line: '#E6E8EC',
  muted: '#6B7280',
  moss: '#10B981',
  mossDeep: '#047857',
  mossSoft: '#D1FAE5',
  caution: '#F59E0B',
  cautionSoft: '#FEF3C7',
  critical: '#EF4444',
  criticalSoft: '#FEE2E2',
  white: '#FFFFFF',
  overlay: 'rgba(15, 23, 42, 0.5)',
} as const;

// Same roles, not a naive inversion: every accent is brightened a step
// (not reused as-is) for legibility against a dark ground — the same
// mechanism the original dark palette already used, just with the new
// cool-neutral/emerald/amber/red identity instead of the old warm one.
// `white` and `overlay` stay fixed regardless of theme — a button's
// on-accent text stays white, and the backdrop just needs to read as
// "backdrop."
export const paletteDark = {
  ink: '#F1F5F9',
  paper: '#0B0F17',
  // Meaningfully lighter than `paper`, not just a shade — this is what
  // actually has to carry "this is a raised surface" now that cards no
  // longer stack a border on top of a shadow that barely shows on a dark
  // background anyway. Real elevation via fill brightness, the same
  // mechanism iOS/Android dark themes use, not an outline standing in for it.
  card: '#161B26',
  line: '#262D3A',
  muted: '#94A3B8',
  moss: '#34D399',
  mossDeep: '#6EE7B7',
  mossSoft: '#064E3B',
  caution: '#FBBF24',
  cautionSoft: '#451A03',
  critical: '#F87171',
  criticalSoft: '#450A0A',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.6)',
} as const;

// Deliberately widened to plain `string` values, not `typeof paletteLight`
// — paletteLight/paletteDark are each `as const`, so their literal hex
// types differ even though the keys match, and a union of two
// differently-literal-typed objects doesn't structurally satisfy either
// one. Every consumer only ever reads these as plain strings anyway.
export type Palette = Record<keyof typeof paletteLight, string>;

// Deprecated: a static light-only palette, kept only so any file this dark
// mode pass missed still compiles and renders in light mode rather than
// breaking outright. Every screen should get its palette from useTheme()
// (theme/ThemeContext.tsx) instead, which resolves to whichever of the two
// palettes above the user's actual preference calls for.
export const palette = paletteLight;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// Three steps, each with one job: sm for small controls/inputs, md for
// cards and buttons (the default), lg for modals/sheets. Collapsed from the
// original five-step scale, which had two radii (16 and 20) doing the same
// "this is a modal surface" job.
export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  hero: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.3 },
  screenTitle: { fontSize: 22, fontWeight: '700' as const },
  dialogTitle: { fontSize: 17, fontWeight: '700' as const },
  sectionTitle: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyBold: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 12.5, fontWeight: '500' as const, letterSpacing: 0.2 },
} as const;

// Apply wherever an amount or count renders (formatGNF output, quantities)
// so digits hold their width and don't visibly reflow on refresh.
// Typed against RN's own TextStyle (not `as const`) — a readonly tuple
// can't satisfy TextStyle['fontVariant'], which is a mutable array type.
export const tabularNums: { fontVariant: TextStyle['fontVariant'] } = { fontVariant: ['tabular-nums'] };

// One elevation method, never stacked with a border: a soft shadow only.
export const cardElevation = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

// Above this window width (roughly: phone landscape / small tablet and up,
// and every PWA desktop browser), AppModal renders as a centered dialog
// instead of a bottom sheet.
export const WIDE_BREAKPOINT = 640;
