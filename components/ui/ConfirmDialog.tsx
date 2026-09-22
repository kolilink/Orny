import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { Ionicons } from '@expo/vector-icons';
import { AppModal } from './AppModal';
import { PressableScale } from './PressableScale';
import { radius, spacing, typography, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { hapticTap, hapticWarning } from '../../utils/haptics';

interface ConfirmDialogProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'default' | 'danger';
}

// Replaces the confirmOverlay/confirmBox pattern copy-pasted per screen
// (see screens/Coach/index.tsx's refresh/reset-key confirmations,
// screens/FactorySettings/index.tsx's approve flow) with one component.
export function ConfirmDialog({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  icon,
  tone = 'default',
}: ConfirmDialogProps) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const accent = tone === 'danger' ? palette.critical : palette.moss;

  const handleConfirm = () => {
    (tone === 'danger' ? hapticWarning : hapticTap)();
    onConfirm();
  };

  return (
    <AppModal visible={visible} onClose={onClose} showCloseButton={false}>
      <View style={styles.container}>
        {icon && <Ionicons name={icon} size={32} color={accent} style={styles.icon} />}
        <Text style={styles.title}>{title}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
        <PressableScale
          style={[styles.actionBtn, { backgroundColor: accent }]}
          onPress={handleConfirm}
        >
          <Text style={styles.actionText}>{confirmLabel}</Text>
        </PressableScale>
        <PressableScale style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>{cancelLabel}</Text>
        </PressableScale>
      </View>
    </AppModal>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { paddingVertical: spacing.sm },
  icon: { alignSelf: 'center', marginBottom: spacing.md },
  title: { ...typography.dialogTitle, color: palette.ink, textAlign: 'center', marginBottom: spacing.xs },
  message: { ...typography.body, color: palette.muted, textAlign: 'center', marginBottom: spacing.lg, lineHeight: 20 },
  actionBtn: {
    borderRadius: radius.md,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  actionText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  cancelBtn: {
    borderRadius: radius.md,
    height: 52,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 16, color: palette.muted, fontWeight: '600' },
});
