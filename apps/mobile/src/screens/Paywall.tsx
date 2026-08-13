import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Linking,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Purchases from 'react-native-purchases';
import type { CustomerInfo, PurchasesError, PurchasesOffering } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast, Button } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import {
  spacingPixels,
  radiusPixels,
  status as statusColors,
  fontFamilyNative,
  fontWeight,
  secondary,
} from '@rallia/design-system';
import { selectionHaptic, lightHaptic } from '@rallia/shared-utils';

import { Logger } from '#/services/logger';
import { useAppNavigation } from '#/navigation/hooks';
import { paywallViewed, paywallDismissed, subscriptionStarted } from '#/services/analytics';
import { useTranslation } from '#/hooks';
import { getPaywallOffering } from '#/lib/revenuecat';
import { getPolicyUrl } from '#/utils/policyUrls';
import { ThemeLogo } from '#/components/ThemeLogo';

type PackageMeta = {
  label: string;
  badge?: string;
  /** Months covered per billing cycle — used to compute the headline monthly equivalent */
  monthsPerCycle: number;
  /** Footer line clarifying the actual billing terms; () for plans where headline === billing */
  billingNote: (priceString: string) => string | null;
  /** Savings vs the monthly plan */
  savingsLine?: string;
};

const PACKAGE_META: Record<string, PackageMeta> = {
  $rc_monthly: {
    label: 'Mensuel',
    monthsPerCycle: 1,
    billingNote: () => 'Annulez à tout moment',
  },
  $rc_six_month: {
    label: 'Saisonnier',
    monthsPerCycle: 6,
    billingNote: price => `Facturé ${price} pour 6 mois`,
    savingsLine: 'Économisez 33%',
  },
  $rc_annual: {
    label: 'Annuel',
    badge: 'Meilleure valeur',
    monthsPerCycle: 12,
    billingNote: price => `Facturé ${price} par an`,
    savingsLine: 'Économisez 60%',
  },
};

function formatCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Hermes fallback if Intl is missing for the currency
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

// Default render order — annual first to anchor on best value, then seasonal, then monthly.
const PACKAGE_ORDER = ['$rc_annual', '$rc_six_month', '$rc_monthly'];

// Horizontal card metrics — wide enough to feel substantial, narrow enough that
// the next card peeks in to signal scrollability on most iPhones.
const CARD_WIDTH = 240;
const CARD_GAP = 12;

type Feature = {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
};

const FEATURES: Feature[] = [
  { icon: 'flash-outline', text: 'Suggestions de matchs enrichies' },
  { icon: 'calendar-outline', text: 'Export calendrier (ICS)' },
  { icon: 'wallet-outline', text: 'Partage de coûts via Stripe' },
  { icon: 'stats-chart-outline', text: 'Historique de performance complet' },
];

const Paywall: React.FC = () => {
  const navigation = useAppNavigation();
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();

  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const tintedPrimary = `${colors.primary}1F`; // ~12% alpha
  // Coral accent for high-attention elements (best-value badge, CTA)
  const secondaryAccent = isDark ? secondary[400] : secondary[500];

  useEffect(() => {
    paywallViewed();
    getPaywallOffering()
      .then(o => {
        setOffering(o);
        const annual = o?.availablePackages.find(p => p.identifier === '$rc_annual');
        setSelectedId(annual?.identifier ?? o?.availablePackages[0]?.identifier ?? null);
      })
      .catch(err => Logger.error('Paywall offering fetch failed', err as Error))
      .finally(() => setIsLoading(false));
  }, []);

  const sortedPackages = useMemo(() => {
    const all = offering?.availablePackages ?? [];
    return [...all].sort(
      (a, b) => PACKAGE_ORDER.indexOf(a.identifier) - PACKAGE_ORDER.indexOf(b.identifier)
    );
  }, [offering]);

  const selectedPackage = useMemo(
    () => sortedPackages.find(p => p.identifier === selectedId) ?? null,
    [sortedPackages, selectedId]
  );

  const handleDismiss = () => {
    lightHaptic();
    paywallDismissed();
    navigation.goBack();
  };

  const handleSelect = (id: string) => {
    if (id !== selectedId) {
      selectionHaptic();
      setSelectedId(id);
    }
  };

  const handlePurchase = async () => {
    if (!selectedPackage || isPurchasing) return;
    setIsPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(selectedPackage);
      const activeId = Object.keys(customerInfo.entitlements.active)[0] ?? 'unknown';
      subscriptionStarted({
        product_id: selectedPackage.product.identifier,
        price: selectedPackage.product.price,
        currency: selectedPackage.product.currencyCode,
      });
      Logger.info('Purchase completed', { activeId });
      navigation.goBack();
    } catch (err) {
      const purchasesError = err as PurchasesError;
      if (purchasesError.userCancelled) return;
      Logger.error('Purchase failed', new Error(purchasesError.message ?? 'unknown'), {
        code: purchasesError.code,
        underlyingErrorMessage: purchasesError.underlyingErrorMessage,
      });
      toast.error('Achat impossible. Réessayez plus tard.');
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    try {
      const info: CustomerInfo = await Purchases.restorePurchases();
      const hasActive = Object.keys(info.entitlements.active).length > 0;
      if (hasActive) {
        toast.success(t('subscription.restore_success'));
        navigation.goBack();
      } else {
        toast.info(t('subscription.restore_none'));
      }
    } catch (err) {
      Logger.error('Restore failed', err as Error);
      toast.error(t('subscription.restore_none'));
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Fixed header — sits above ScrollView so close button stays put while content scrolls */}
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.closeButton, { backgroundColor: tintedPrimary }]}
          onPress={handleDismiss}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Fermer"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroLogoRow}>
            <ThemeLogo width={140} height={42} />
            <View style={[styles.plusBadge, { backgroundColor: colors.primary }]}>
              <Text color="#fff" style={styles.plusBadgeText}>
                PLUS
              </Text>
            </View>
          </View>
          <Text size="base" color={colors.textSecondary} style={styles.heroTagline}>
            Trouvez plus de matchs, plus vite — et au prix de deux boîtes de balles par mois.
          </Text>
        </View>

        {/* Features */}
        <View
          style={[
            styles.featuresCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {FEATURES.map((f, idx) => (
            <View
              key={f.text}
              style={[
                styles.featureRow,
                idx > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <View style={[styles.featureIcon, { backgroundColor: tintedPrimary }]}>
                <Ionicons name={f.icon} size={18} color={colors.primary} />
              </View>
              <Text size="sm" weight="medium" color={colors.text} style={styles.featureText}>
                {f.text}
              </Text>
              <Ionicons name="checkmark-circle" size={18} color={statusColors.success.DEFAULT} />
            </View>
          ))}
        </View>

        {/* Packages */}
        {isLoading ? (
          <View style={styles.loaderRow}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : sortedPackages.length === 0 ? (
          <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
            Plans indisponibles. Réessayez plus tard.
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_WIDTH + CARD_GAP}
            snapToAlignment="start"
            decelerationRate="fast"
            style={styles.packagesScroll}
            contentContainerStyle={styles.packagesScrollContent}
          >
            {sortedPackages.map(pkg => {
              const isSelected = pkg.identifier === selectedId;
              const meta = PACKAGE_META[pkg.identifier];
              const label = meta?.label ?? pkg.product.title;
              return (
                <TouchableOpacity
                  key={pkg.identifier}
                  onPress={() => handleSelect(pkg.identifier)}
                  activeOpacity={0.85}
                  style={[
                    styles.packageCard,
                    {
                      backgroundColor: isSelected ? tintedPrimary : colors.card,
                      borderColor: isSelected ? colors.primary : colors.border,
                      borderWidth: isSelected ? 2 : 1,
                      // Compensate for the 1px extra border on selected so layout doesn't shift
                      paddingVertical: isSelected ? spacingPixels[5] - 1 : spacingPixels[5],
                      paddingHorizontal: isSelected ? spacingPixels[5] - 1 : spacingPixels[5],
                    },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${label}, ${pkg.product.priceString}`}
                >
                  {/* Top-right radio */}
                  <View
                    style={[
                      styles.radio,
                      {
                        borderColor: isSelected ? colors.primary : colors.border,
                        backgroundColor: isSelected ? colors.primary : 'transparent',
                      },
                    ]}
                  >
                    {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>

                  {meta?.badge && (
                    <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                      <Text size="xs" weight="semibold" color="#fff">
                        {meta.badge}
                      </Text>
                    </View>
                  )}

                  <View style={styles.packageBody}>
                    <Text size="lg" weight="semibold" color={colors.text}>
                      {label}
                    </Text>
                    {meta && (
                      <View style={styles.priceRow}>
                        <Text size="3xl" weight="bold" color={colors.text} style={styles.priceMain}>
                          {formatCurrency(
                            pkg.product.price / meta.monthsPerCycle,
                            pkg.product.currencyCode
                          )}
                        </Text>
                        <Text size="sm" color={colors.textSecondary} style={styles.priceSuffix}>
                          {' /mois'}
                        </Text>
                      </View>
                    )}
                    {meta && (
                      <Text size="xs" color={colors.textMuted}>
                        {meta.billingNote(pkg.product.priceString)}
                      </Text>
                    )}
                    {meta?.savingsLine && (
                      <View
                        style={[styles.savingsPill, { backgroundColor: `${secondaryAccent}1F` }]}
                      >
                        <Ionicons name="trending-down" size={12} color={secondaryAccent} />
                        <Text size="xs" weight="semibold" color={secondaryAccent}>
                          {meta.savingsLine}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* CTA */}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={isPurchasing}
          disabled={!selectedPackage}
          onPress={handlePurchase}
          themeColors={{
            primary: secondaryAccent,
            primaryForeground: '#ffffff',
            buttonActive: secondaryAccent,
            buttonInactive: colors.border,
            buttonTextActive: '#ffffff',
            buttonTextInactive: colors.textMuted,
            text: colors.text,
            textMuted: colors.textMuted,
            border: colors.border,
            background: colors.background,
          }}
          isDark={isDark}
        >
          Démarrer Rallia Plus
        </Button>

        {/* Trust line */}
        <Text size="xs" color={colors.textMuted} style={styles.trustLine}>
          Annulez à tout moment depuis vos réglages App Store.
        </Text>

        {/* Restore */}
        <TouchableOpacity onPress={handleRestore} disabled={isRestoring} style={styles.restore}>
          {isRestoring ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <Text size="sm" weight="medium" color={colors.primary}>
              {t('subscription.restore')}
            </Text>
          )}
        </TouchableOpacity>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => Linking.openURL(getPolicyUrl('privacy', locale))}>
            <Text size="xs" color={colors.textMuted}>
              {t('subscription.privacy_policy')}
            </Text>
          </TouchableOpacity>
          <Text size="xs" color={colors.textMuted}>
            {' · '}
          </Text>
          <TouchableOpacity onPress={() => Linking.openURL(getPolicyUrl('terms', locale))}>
            <Text size="xs" color={colors.textMuted}>
              {t('subscription.terms_of_service')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[5],
    paddingBottom: spacingPixels[2],
    zIndex: 10,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[6],
    gap: spacingPixels[6],
  },
  hero: {
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  heroLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  plusBadge: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    marginTop: 4,
  },
  plusBadgeText: {
    fontFamily: fontFamilyNative.headingExtraBold,
    // Paired with the family so the system fallback keeps the weight if the
    // custom face is unavailable (see the shared Text component).
    fontWeight: fontWeight.extrabold,
    fontSize: 14,
    letterSpacing: 1.2,
  },
  heroTagline: {
    textAlign: 'center',
    paddingHorizontal: spacingPixels[3],
    lineHeight: 22,
  },
  featuresCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[3.5],
    paddingHorizontal: spacingPixels[4],
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
  },
  packagesScroll: {
    // Bleed to screen edges so cards can scroll past parent's horizontal padding
    marginHorizontal: -spacingPixels[5],
    // Pull closer to the features card above (parent uses gap: 24)
    marginTop: -spacingPixels[3],
  },
  packagesScrollContent: {
    paddingHorizontal: spacingPixels[5],
    gap: CARD_GAP,
    paddingTop: spacingPixels[8],
    paddingBottom: spacingPixels[2],
  },
  packageCard: {
    width: CARD_WIDTH,
    borderRadius: radiusPixels.xl,
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  radio: {
    position: 'absolute',
    top: spacingPixels[3],
    right: spacingPixels[3],
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -16,
    left: spacingPixels[4],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: 3,
    borderRadius: radiusPixels.full,
    zIndex: 1,
    overflow: 'visible',
  },
  packageBody: {
    gap: spacingPixels[1],
    paddingRight: spacingPixels[6], // leave room for the radio
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 0,
  },
  priceMain: {
    lineHeight: 32,
  },
  priceSuffix: {
    marginLeft: 2,
  },
  savingsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.full,
    alignSelf: 'flex-start',
    marginTop: spacingPixels[1],
  },
  loaderRow: {
    paddingVertical: spacingPixels[6],
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacingPixels[6],
  },
  trustLine: {
    textAlign: 'center',
    marginTop: -spacingPixels[2],
  },
  restore: {
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacingPixels[1],
  },
});

export default Paywall;
