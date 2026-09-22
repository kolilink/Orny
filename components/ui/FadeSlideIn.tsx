import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

interface FadeSlideInProps {
  children: React.ReactNode;
  index?: number;
  style?: ViewStyle;
}

const STAGGER_MS = 40;
// Capped so a long list doesn't visibly cascade in for seconds — past this
// many rows, everything past it appears together instead of queuing further
// behind them. The same restraint Spotify/Airbnb-style list reveals use.
const MAX_STAGGER_INDEX = 10;

// Wraps one list/grid item so it fades and slides up into place on first
// appearance, staggered by its position — this is what makes a screen's
// content feel like it's arriving rather than just being present the
// instant the screen mounts. Keyed items (key={item.id} at the call site)
// only ever animate once, the first time that key enters the tree — a
// background re-sync that refreshes the same items in place does not
// retrigger this, since React reuses the existing instance rather than
// remounting it.
// Memoized for the same reason PressableScale is — keyed by item.id at the
// call site so it never remounts on a background refresh, but without memo
// it still re-executes (and re-diffs its Animated.View) on every unrelated
// re-render of the screen that renders it.
export const FadeSlideIn = React.memo(function FadeSlideIn({ children, index = 0, style }: FadeSlideInProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      delay: Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS,
      useNativeDriver: true,
    }).start();
    // Mount-only by design — see the doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
});
