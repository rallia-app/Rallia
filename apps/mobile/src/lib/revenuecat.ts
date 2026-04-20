import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { CustomerInfo } from 'react-native-purchases';

const RC_API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';

export const PRO_ENTITLEMENT_ID = 'pro';

let _initialized = false;

export function initRevenueCat(): void {
  if (_initialized) return;
  _initialized = true;
  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }
  Purchases.configure({ apiKey: RC_API_KEY_IOS });
}

export async function identifyRevenueCatUser(supabaseUserId: string): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.logIn(supabaseUserId);
  return customerInfo;
}

export async function resetRevenueCatUser(): Promise<void> {
  await Purchases.logOut();
}

export function isEntitlementActive(
  customerInfo: CustomerInfo,
  entitlementId = PRO_ENTITLEMENT_ID
): boolean {
  return entitlementId in customerInfo.entitlements.active;
}
