import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleProp, TextStyle } from 'react-native';
import { Text } from './AppText';
import { tabularNums } from '../../theme/tokens';

interface CountUpNumberProps {
  value: number;
  formatter?: (n: number) => string;
  duration?: number;
  style?: StyleProp<TextStyle>;
}

// Robinhood-style "the number itself moves": when a hero figure (revenue,
// profit, stock level) changes, it counts from the old value to the new one
// instead of snapping — that motion is what makes a number feel live rather
// than just printed. Animated.Value + a JS listener (text content can't be
// natively driven, so useNativeDriver stays false here) drives a formatted
// string on every frame; always paired with tabular figures so digit width
// never jitters mid-count. Skips the animation entirely on first mount
// (nothing to count up *from* yet) and on any change so large or fast that
// counting through it would just look like noise rather than motion.
export function CountUpNumber({ value, formatter = (n) => String(Math.round(n)), duration = 600, style }: CountUpNumberProps) {
  const animated = useRef(new Animated.Value(value)).current;
  const [display, setDisplay] = useState(formatter(value));
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      setDisplay(formatter(value));
      return;
    }
    const listenerId = animated.addListener(({ value: v }) => setDisplay(formatter(v)));
    Animated.timing(animated, { toValue: value, duration, useNativeDriver: false }).start();
    return () => animated.removeListener(listenerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <Text style={[tabularNums, style]}>{display}</Text>;
}
