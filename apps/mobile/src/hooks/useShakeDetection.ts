/**
 * useShakeDetection Hook
 *
 * Detects device shake gestures using the accelerometer.
 * Useful for triggering quick bug reports when users are frustrated.
 *
 * @example
 * ```tsx
 * useShakeDetection({
 *   onShake: () => openBugReportSheet(),
 *   enabled: true,
 * });
 * ```
 */

import { useEffect, useRef, useCallback } from 'react';
import { Accelerometer, type AccelerometerMeasurement } from 'expo-sensors';
import { AppState, type AppStateStatus } from 'react-native';

interface UseShakeDetectionOptions {
  /** Callback fired when shake is detected */
  onShake: () => void;
  /** Whether shake detection is enabled (default: true) */
  enabled?: boolean;
  /** Minimum acceleration threshold to trigger shake (default: 1.5) */
  threshold?: number;
  /** Minimum number of rapid movements to count as shake (default: 3) */
  shakeCount?: number;
  /** Time window in ms to detect shake movements (default: 1000) */
  timeWindow?: number;
  /** Cooldown in ms before next shake can be detected (default: 2000) */
  cooldown?: number;
}

/**
 * Hook to detect device shake gestures
 */
export const useShakeDetection = ({
  onShake,
  enabled = true,
  threshold = 1.5,
  shakeCount = 3,
  timeWindow = 1000,
  cooldown = 2000,
}: UseShakeDetectionOptions): void => {
  // Track shake events
  const shakesRef = useRef<number[]>([]);
  const lastShakeTimeRef = useRef<number>(0);
  const lastAccelerationRef = useRef<AccelerometerMeasurement | null>(null);
  const subscriptionRef = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);

  // Calculate magnitude change from previous reading
  const calculateAccelerationChange = useCallback((current: AccelerometerMeasurement): number => {
    const prev = lastAccelerationRef.current;
    if (!prev) {
      lastAccelerationRef.current = current;
      return 0;
    }

    // Calculate the change in acceleration (delta)
    const deltaX = Math.abs(current.x - prev.x);
    const deltaY = Math.abs(current.y - prev.y);
    const deltaZ = Math.abs(current.z - prev.z);

    // Update last acceleration
    lastAccelerationRef.current = current;

    // Return the magnitude of the change
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
  }, []);

  // Handle accelerometer data
  const handleAccelerometerData = useCallback(
    (data: AccelerometerMeasurement) => {
      const accelerationChange = calculateAccelerationChange(data);
      const now = Date.now();

      // Check if acceleration change exceeds threshold
      if (accelerationChange > threshold) {
        // Add this shake event
        shakesRef.current.push(now);

        // Remove old events outside the time window
        shakesRef.current = shakesRef.current.filter(time => now - time < timeWindow);

        // Check if we have enough shakes and cooldown has passed
        if (shakesRef.current.length >= shakeCount && now - lastShakeTimeRef.current > cooldown) {
          // Shake detected!
          lastShakeTimeRef.current = now;
          shakesRef.current = []; // Reset
          onShake();
        }
      }
    },
    [calculateAccelerationChange, threshold, shakeCount, timeWindow, cooldown, onShake]
  );

  // Start/stop accelerometer based on app state
  const handleAppStateChange = useCallback(
    (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active' && enabled) {
        // App is in foreground, start listening
        if (!subscriptionRef.current) {
          Accelerometer.setUpdateInterval(100); // 10 readings per second
          subscriptionRef.current = Accelerometer.addListener(handleAccelerometerData);
        }
      } else {
        // App is in background, stop listening to save battery
        if (subscriptionRef.current) {
          subscriptionRef.current.remove();
          subscriptionRef.current = null;
        }
      }
    },
    [enabled, handleAccelerometerData]
  );

  useEffect(() => {
    if (!enabled) {
      // Clean up if disabled
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      return;
    }

    // Start accelerometer
    Accelerometer.setUpdateInterval(100);
    subscriptionRef.current = Accelerometer.addListener(handleAccelerometerData);

    // Listen for app state changes
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // Cleanup
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      appStateSubscription.remove();
    };
  }, [enabled, handleAccelerometerData, handleAppStateChange]);
};

export default useShakeDetection;
