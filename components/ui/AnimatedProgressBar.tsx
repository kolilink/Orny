import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

interface AnimatedProgressBarProps {
  progress: number; // 0-100
  color?: string;
  height?: number;
  duration?: number;
  style?: ViewStyle;
}

// A progress bar's fill snaps to its new width by default in RN — animating
// it instead (Animated.timing driving `width`; layout props can't use the
// native driver) is what makes it read as "filling up" rather than just
// "showing a number," the same satisfying-motion trick behind Duolingo's
// and Spotify's own progress indicators.
export function AnimatedProgressBar({ progress, color, height = 4, duration = 500, style }: AnimatedProgressBarProps) {
  const { palette } = useTheme();
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: Math.max(0, Math.min(100, progress)),
      duration,
      useNativeDriver: false,
    }).start();
  }, [progress, width, duration]);

  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: palette.line, overflow: 'hidden' }, style]}>
      <Animated.View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: color ?? palette.moss,
          width: width.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}
