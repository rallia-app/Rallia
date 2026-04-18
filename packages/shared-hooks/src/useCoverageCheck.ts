/**
 * useCoverageCheck Hook
 *
 * Checks whether a location (latitude/longitude) is within coverage —
 * i.e. within 15km of at least one facility that has court availabilities.
 * Uses the check_postal_code_coverage Supabase RPC.
 */

import { useState, useCallback } from 'react';
import { checkPostalCodeCoverage } from '@rallia/shared-services';

interface UseCoverageCheckReturn {
  /** Check if the given coordinates are within coverage */
  checkCoverage: (latitude: number, longitude: number) => Promise<boolean>;
  /** Whether a coverage check is in progress */
  isChecking: boolean;
  /** Result of the last coverage check (null = not checked yet) */
  isInCoverage: boolean | null;
  /** Error message if coverage check failed */
  error: string | null;
  /** Reset all state */
  reset: () => void;
}

export function useCoverageCheck(): UseCoverageCheckReturn {
  const [isChecking, setIsChecking] = useState(false);
  const [isInCoverage, setIsInCoverage] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkCoverage = useCallback(
    async (latitude: number, longitude: number): Promise<boolean> => {
      setIsChecking(true);
      setError(null);
      try {
        const result = await checkPostalCodeCoverage(latitude, longitude);
        setIsInCoverage(result);
        return result;
      } catch (err) {
        console.error('Coverage check error:', err);
        setError('coverageCheckFailed');
        setIsInCoverage(null);
        return false;
      } finally {
        setIsChecking(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setIsChecking(false);
    setIsInCoverage(null);
    setError(null);
  }, []);

  return { checkCoverage, isChecking, isInCoverage, error, reset };
}

export default useCoverageCheck;
