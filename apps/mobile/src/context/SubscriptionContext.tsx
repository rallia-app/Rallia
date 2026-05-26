import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type PropsWithChildren,
} from 'react';
import Purchases from 'react-native-purchases';
import type { CustomerInfo } from 'react-native-purchases';
import { isRunningInExpoGo } from 'expo';

import {
  identifyRevenueCatUser,
  resetRevenueCatUser,
  isRevenueCatSupported,
  PRO_ENTITLEMENT_ID,
} from '#/lib/revenuecat';
import { supabase } from '#/lib/supabase';
import { navigationRef } from '#/navigation';
import { Logger } from '#/services/logger';

import { useAuth } from './AuthContext';

export type SubscriptionStatus = 'none' | 'active' | 'cancelling' | 'billing_issue' | 'expired';

export type SubscriptionContextValue = {
  customerInfo: CustomerInfo | null;
  isProActive: boolean;
  subscriptionStatus: SubscriptionStatus;
  isLoading: boolean;
  error: Error | null;
  refreshSubscription: () => Promise<void>;
  presentPaywall: () => void;
  restorePurchases: () => Promise<boolean>;
};

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

function deriveStatus(
  customerInfo: CustomerInfo | null,
  dbStatus: string | null
): SubscriptionStatus {
  // Billing issue from webhook overrides RC (may coexist with grace period entitlement)
  if (dbStatus === 'billing_issue') return 'billing_issue';

  const proEntitlement = customerInfo?.entitlements.active[PRO_ENTITLEMENT_ID];

  if (proEntitlement) {
    return proEntitlement.willRenew ? 'active' : 'cancelling';
  }

  // Previously had the entitlement → expired
  if (customerInfo?.entitlements.all[PRO_ENTITLEMENT_ID]) return 'expired';

  return 'none';
}

export function SubscriptionProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [dbStatus, setDbStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const listenerRef = useRef<((info: CustomerInfo) => void) | null>(null);
  const wasIdentifiedRef = useRef(false);

  const fetchDbSubscription = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('player_subscription')
        .select('status')
        .eq('player_id', userId)
        .maybeSingle();
      setDbStatus(data?.status ?? null);
    } catch (err) {
      Logger.warn('Failed to fetch subscription from DB', { error: err });
    }
  }, []);

  // Identify/reset RC user when auth changes and set up CustomerInfo listener
  useEffect(() => {
    if (isRunningInExpoGo() || !isRevenueCatSupported) {
      setIsLoading(false);
      return;
    }

    if (!user?.id) {
      // Only logOut if we previously called logIn — avoids RC error on anonymous users
      if (wasIdentifiedRef.current) {
        resetRevenueCatUser().catch(() => {});
        wasIdentifiedRef.current = false;
      }
      setCustomerInfo(null);
      setDbStatus(null);
      setIsLoading(false);
      if (listenerRef.current) {
        Purchases.removeCustomerInfoUpdateListener(listenerRef.current);
        listenerRef.current = null;
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    const userId = user.id;

    identifyRevenueCatUser(userId)
      .then(info => {
        wasIdentifiedRef.current = true;
        setCustomerInfo(info);
        return fetchDbSubscription(userId);
      })
      .catch(err => {
        Logger.error('Failed to identify RevenueCat user', err as Error);
        setError(err instanceof Error ? err : new Error('Failed to load subscription'));
      })
      .finally(() => setIsLoading(false));

    // Listen for real-time RC updates (renewals, purchases, etc.)
    const listener = (info: CustomerInfo) => {
      setCustomerInfo(info);
      // Refresh DB status after RC update (webhook may have fired)
      fetchDbSubscription(userId).catch(() => {});
    };

    Purchases.addCustomerInfoUpdateListener(listener);
    listenerRef.current = listener;

    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
      listenerRef.current = null;
    };
  }, [user?.id, fetchDbSubscription]);

  // Extract userId so React Compiler can preserve these memos; it otherwise
  // widens the user?.id dep to the whole user object and bails on the provider.
  const userId = user?.id;

  const refreshSubscription = useCallback(async () => {
    if (!userId || isRunningInExpoGo() || !isRevenueCatSupported) return;
    try {
      const info = await Purchases.getCustomerInfo();
      setCustomerInfo(info);
      await fetchDbSubscription(userId);
    } catch (err) {
      Logger.error('Failed to refresh subscription', err as Error);
      setError(err instanceof Error ? err : new Error('Failed to refresh'));
    }
  }, [userId, fetchDbSubscription]);

  const presentPaywall = useCallback(() => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('Paywall');
    }
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (isRunningInExpoGo() || !isRevenueCatSupported) return false;
    try {
      const info = await Purchases.restorePurchases();
      setCustomerInfo(info);
      if (userId) {
        await fetchDbSubscription(userId);
      }
      return PRO_ENTITLEMENT_ID in info.entitlements.active;
    } catch (err) {
      Logger.error('Failed to restore purchases', err as Error);
      throw err;
    }
  }, [userId, fetchDbSubscription]);

  const subscriptionStatus = deriveStatus(customerInfo, dbStatus);
  const isProActive = PRO_ENTITLEMENT_ID in (customerInfo?.entitlements.active ?? {});

  const value: SubscriptionContextValue = {
    customerInfo,
    isProActive,
    subscriptionStatus,
    isLoading,
    error,
    refreshSubscription,
    presentPaywall,
    restorePurchases,
  };

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionContextValue {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within SubscriptionProvider');
  }
  return context;
}
