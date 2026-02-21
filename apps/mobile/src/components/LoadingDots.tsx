import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'

interface Props {
  readonly isDark: boolean
}

export function LoadingDots({ isDark }: Props): React.JSX.Element {
  const dot1 = useRef(new Animated.Value(0)).current
  const dot2 = useRef(new Animated.Value(0)).current
  const dot3 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const createAnimation = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      )

    const anim = Animated.parallel([
      createAnimation(dot1, 0),
      createAnimation(dot2, 150),
      createAnimation(dot3, 300),
    ])

    anim.start()
    return () => anim.stop()
  }, [dot1, dot2, dot3])

  const dotColor = isDark ? '#666' : '#999'

  return (
    <View style={styles.container}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View
          key={i.toString()}
          style={[
            styles.dot,
            { backgroundColor: dotColor },
            {
              transform: [
                {
                  scale: dot.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.4],
                  }),
                },
              ],
              opacity: dot.interpolate({
                inputRange: [0, 1],
                outputRange: [0.4, 1],
              }),
            },
          ]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
