import * as Haptics from 'expo-haptics';

// Every call is fire-and-forget and swallows its own error — haptics are a
// polish layer, never something a user-facing action should be blocked or
// crashed by. The iOS Simulator has no haptic hardware at all and some
// Android devices have no vibration motor; both must silently no-op rather
// than throw.
const safe = (fn: () => Promise<void>) => {
  fn().catch(() => {});
};

// A light tap — a product added to the cart, a quantity stepper +/-.
export const hapticTap = () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

// A confirmed, positive outcome — a sale finalized, a batch logged, a
// payment recorded.
export const hapticSuccess = () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

// The moment a destructive or blocking action is actually confirmed —
// delete, cancel a sale, remove a member. Not the moment the confirmation
// dialog opens; the moment the destructive choice is actually taken.
export const hapticWarning = () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));

// Choosing among a small set of options — a payment method chip, a segmented
// toggle.
export const hapticSelect = () => safe(() => Haptics.selectionAsync());
