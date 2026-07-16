/**
 * Create Season Sheet
 *
 * Organizer-side single-step form to create a season for a league. Replaces the
 * former inline form on LeagueDetail's "seasons" tab. The season mutation
 * invalidates the league's seasons query, so the list refreshes on its own.
 *
 * The season is also where a league gets priced: a league is permanent, you pay
 * to play a season. Fee settings are only editable while the season is a draft
 * (server-gated), so this create form is the main place they're set — hence the
 * live quote preview here rather than a later edit screen.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Button, Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  formatPrice,
  quoteRegistration,
  type FeePayer,
} from '@rallia/shared-utils';
import { useCreateSeason } from '@rallia/shared-hooks';
import type { Enums } from '@rallia/shared-types';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';
import * as Analytics from '#/services/analytics';

import { SheetDateField } from './SheetDateField';

const SHEET_ID = 'create-season';

type RefundKind = Enums<'refund_policy_kind_enum'>;

/** Dollars string → integer cents. Tolerates "", "12", "12.5", "12.50". */
function dollarsToCents(input: string): number {
  const n = Number.parseFloat(input.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function CreateSeasonActionSheet({ payload }: SheetProps<'create-season'>) {
  const leagueId = payload?.leagueId ?? '';

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState<Date>(() => new Date());
  const [endDate, setEndDate] = useState<Date>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d;
  });

  // Fee settings. Empty/0 = free season, which is the default.
  const [entryFee, setEntryFee] = useState('');
  const [feePayer, setFeePayer] = useState<FeePayer>('player_pays');
  const [refundKind, setRefundKind] = useState<RefundKind>('none');
  const [refundPct, setRefundPct] = useState('50');

  const entryFeeCents = dollarsToCents(entryFee);
  const isPaid = entryFeeCents > 0;

  // Client-side mirror of season_fee_quote, for the preview only — the server
  // recomputes the authoritative amounts at checkout.
  const quote = useMemo(
    () => quoteRegistration(entryFeeCents, feePayer),
    [entryFeeCents, feePayer]
  );

  const formatDate = useCallback(
    (d: Date): string =>
      d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    [locale]
  );

  const { mutate: createSeason, isPending } = useCreateSeason(leagueId, {
    onSuccess: season => {
      void SheetManager.hide(SHEET_ID).then(() => {
        successHaptic();
        toast.success(t('leagueDetail.seasonCreated'));
        Analytics.seasonCreatedAnalytics({
          leagueId,
          seasonId: season.id,
          hasOverride: false,
          isPaid: season.entry_fee_cents > 0,
          entryFeeCents: season.entry_fee_cents,
          feePayer: season.fee_payer,
        });
      });
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('leagueDetail.errors.generic'));
    },
  });

  const handleClose = useCallback(() => {
    void SheetManager.hide(SHEET_ID);
  }, []);

  const handleStartChange = useCallback((date: Date) => {
    setStartDate(date);
    setEndDate(prev => (prev < date ? date : prev));
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      warningHaptic();
      toast.error(t('leagueDetail.validation.seasonNameRequired'));
      return;
    }
    if (endDate < startDate) {
      warningHaptic();
      toast.error(t('leagueDetail.validation.endBeforeStart'));
      return;
    }
    const pct = Number.parseInt(refundPct, 10);
    if (isPaid && refundKind === 'partial' && (!Number.isFinite(pct) || pct < 1 || pct > 99)) {
      warningHaptic();
      toast.error(t('leagueDetail.createSeason.payments.refundPctInvalid'));
      return;
    }
    lightHaptic();
    // A free season sends the fee fields at their defaults so the server's
    // partial/bps CHECK can't be tripped by leftover UI state.
    createSeason({
      name: trimmed,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      entryFeeCents,
      feePayer: isPaid ? feePayer : 'player_pays',
      refundPolicyKind: isPaid ? refundKind : 'none',
      refundPartialBps: isPaid && refundKind === 'partial' ? pct * 100 : null,
    });
  }, [
    name,
    startDate,
    endDate,
    createSeason,
    toast,
    t,
    entryFeeCents,
    isPaid,
    feePayer,
    refundKind,
    refundPct,
  ]);

  return (
    <BaseActionSheet
      title={t('leagueDetail.createSeason.title')}
      onClose={handleClose}
      flex={false}
      scrollable
      footer={
        <Button
          variant="primary"
          fullWidth
          onPress={handleSubmit}
          disabled={isPending}
          loading={isPending}
          isDark={isDark}
          testID="cta-create-season-submit"
        >
          {isPending
            ? t('leagueDetail.createSeason.creating')
            : t('leagueDetail.createSeason.submit')}
        </Button>
      }
    >
      <View style={styles.body}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('leagueDetail.createSeason.namePlaceholder')}
          placeholderTextColor={colors.textMuted}
          testID="season-name-input"
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />
        <SheetDateField
          label={t('leagueDetail.createSeason.startDate')}
          value={startDate}
          displayValue={formatDate(startDate)}
          mode="date"
          onChange={handleStartChange}
          colors={colors}
          isDark={isDark}
          testID="season-start-field"
        />
        <SheetDateField
          label={t('leagueDetail.createSeason.endDate')}
          value={endDate}
          displayValue={formatDate(endDate)}
          mode="date"
          minimumDate={startDate}
          onChange={setEndDate}
          colors={colors}
          isDark={isDark}
          testID="season-end-field"
        />

        {/* Entry & payments. Leaving the fee empty keeps the season free, which
            is the default and skips every payment concern below. */}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.text}>
            {t('leagueDetail.createSeason.payments.entryFeeLabel')}
          </Text>
          <View
            style={[
              styles.priceRow,
              { backgroundColor: colors.inputBackground, borderColor: colors.border },
            ]}
          >
            <Text size="base" weight="semibold" color={colors.textMuted}>
              $
            </Text>
            <TextInput
              value={entryFee}
              onChangeText={setEntryFee}
              placeholder="0"
              keyboardType="decimal-pad"
              placeholderTextColor={colors.textMuted}
              testID="season-entry-fee-input"
              style={[styles.priceInput, { color: colors.text }]}
            />
          </View>
          <Text size="xs" color={colors.textMuted}>
            {isPaid
              ? t('leagueDetail.createSeason.payments.entryFeeHintPaid')
              : t('leagueDetail.createSeason.payments.entryFeeHintFree')}
          </Text>
        </View>

        {isPaid && (
          <>
            <View style={styles.fieldGroup}>
              <Text size="sm" weight="semibold" color={colors.text}>
                {t('leagueDetail.createSeason.payments.whoPaysLabel')}
              </Text>
              {(['player_pays', 'organizer_absorbs'] as const).map(opt => (
                <OptionRow
                  key={opt}
                  selected={feePayer === opt}
                  title={t(
                    (opt === 'player_pays'
                      ? 'leagueDetail.createSeason.payments.playerPaysTitle'
                      : 'leagueDetail.createSeason.payments.organizerAbsorbsTitle') as TranslationKey
                  )}
                  description={t(
                    (opt === 'player_pays'
                      ? 'leagueDetail.createSeason.payments.playerPaysDescription'
                      : 'leagueDetail.createSeason.payments.organizerAbsorbsDescription') as TranslationKey
                  )}
                  onPress={() => {
                    lightHaptic();
                    setFeePayer(opt);
                  }}
                  colors={colors}
                  testID={`season-fee-payer-${opt}`}
                />
              ))}
            </View>

            {/* The organizer sees exactly what the player will be charged and
                what lands in their account, before either number is real. */}
            <View
              style={[
                styles.preview,
                { backgroundColor: colors.inputBackground, borderColor: colors.border },
              ]}
              testID="season-fee-preview"
            >
              <PreviewRow
                label={t('leagueDetail.createSeason.payments.previewPlayersPay')}
                value={formatPrice(quote.totalCents, 'CAD', { locale })}
                colors={colors}
                strong
              />
              <PreviewRow
                label={t('leagueDetail.createSeason.payments.previewServiceFee')}
                value={formatPrice(quote.serviceFeeCents, 'CAD', { locale })}
                colors={colors}
              />
              <PreviewRow
                label={t('leagueDetail.createSeason.payments.previewFeeTax')}
                value={formatPrice(quote.feeTaxCents, 'CAD', { locale })}
                colors={colors}
              />
              <PreviewRow
                label={t('leagueDetail.createSeason.payments.previewYouReceive')}
                value={formatPrice(quote.organizerReceivesCents, 'CAD', { locale })}
                colors={colors}
                strong
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text size="sm" weight="semibold" color={colors.text}>
                {t('leagueDetail.createSeason.payments.refundLabel')}
              </Text>
              {(['full', 'partial', 'none'] as const).map(kind => (
                <OptionRow
                  key={kind}
                  selected={refundKind === kind}
                  title={t(
                    `leagueDetail.createSeason.payments.refund${
                      kind === 'full' ? 'Full' : kind === 'partial' ? 'Partial' : 'None'
                    }Title` as TranslationKey
                  )}
                  description={t(
                    `leagueDetail.createSeason.payments.refund${
                      kind === 'full' ? 'Full' : kind === 'partial' ? 'Partial' : 'None'
                    }Description` as TranslationKey
                  )}
                  onPress={() => {
                    lightHaptic();
                    setRefundKind(kind);
                  }}
                  colors={colors}
                  testID={`season-refund-${kind}`}
                />
              ))}
              {refundKind === 'partial' && (
                <View
                  style={[
                    styles.priceRow,
                    { backgroundColor: colors.inputBackground, borderColor: colors.border },
                  ]}
                >
                  <TextInput
                    value={refundPct}
                    onChangeText={setRefundPct}
                    keyboardType="number-pad"
                    placeholder="50"
                    placeholderTextColor={colors.textMuted}
                    testID="season-refund-pct-input"
                    style={[styles.priceInput, { color: colors.text }]}
                  />
                  <Text size="base" weight="semibold" color={colors.textMuted}>
                    %
                  </Text>
                </View>
              )}
              <Text size="xs" color={colors.textMuted}>
                {t('leagueDetail.createSeason.payments.refundFeeNote')}
              </Text>
            </View>

            <Text size="xs" color={colors.textMuted}>
              {t('leagueDetail.createSeason.payments.payoutNote')}
            </Text>
          </>
        )}
      </View>
    </BaseActionSheet>
  );
}

function OptionRow({
  selected,
  title,
  description,
  onPress,
  colors,
  testID,
}: {
  selected: boolean;
  title: string;
  description: string;
  onPress: () => void;
  colors: { primary: string; border: string; text: string; textMuted: string };
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      testID={testID}
      style={[styles.option, { borderColor: selected ? colors.primary : colors.border }]}
    >
      <View style={styles.optionText}>
        <Text size="sm" weight="semibold" color={colors.text}>
          {title}
        </Text>
        <Text size="xs" color={colors.textMuted}>
          {description}
        </Text>
      </View>
      {selected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
    </TouchableOpacity>
  );
}

function PreviewRow({
  label,
  value,
  colors,
  strong = false,
}: {
  label: string;
  value: string;
  colors: { text: string; textMuted: string };
  strong?: boolean;
}) {
  return (
    <View style={styles.previewRow}>
      <Text size="sm" color={strong ? colors.text : colors.textMuted}>
        {label}
      </Text>
      <Text
        size="sm"
        weight={strong ? 'semibold' : 'regular'}
        color={strong ? colors.text : colors.textMuted}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacingPixels[3],
  },
  input: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    fontSize: 16,
  },
  divider: {
    height: 1,
    marginVertical: spacingPixels[1],
  },
  fieldGroup: {
    gap: spacingPixels[2],
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
  },
  priceInput: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    fontSize: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
  },
  optionText: {
    flex: 1,
    gap: spacingPixels[1],
  },
  preview: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
    gap: spacingPixels[1],
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});

export default CreateSeasonActionSheet;
