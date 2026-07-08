'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import type { Appearance } from '@stripe/stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { ArrowLeft, Heart, Lock, Mail } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { primary, secondary, darkMode } from '@rallia/design-system';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  donateAmountSelected,
  donateCompleted,
  donateFailed,
  donateIntentCreated,
} from '@/lib/analytics';

const DONATE_CURRENCY = 'CAD';

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

const PRESET_AMOUNTS = [5, 10, 25, 50, 100];

type Step = 'IDLE' | 'LOADING' | 'CHECKOUT' | 'COMPLETED';

function getAppearance(theme: string | undefined): Appearance {
  const isDark = theme === 'dark';
  return {
    theme: isDark ? 'night' : 'stripe',
    variables: {
      colorPrimary: primary[500],
      colorDanger: isDark ? darkMode.secondary[500] : secondary[500],
      borderRadius: '8px',
      fontFamily: 'Inter, sans-serif',
      fontSizeBase: '15px',
      ...(isDark && { colorBackground: '#232323' }),
    },
    rules: {
      '.Input': {
        borderColor: isDark ? '#3a3a3a' : '#e2e8f0',
        boxShadow: 'none',
      },
      '.Input:focus': {
        borderColor: primary[500],
        boxShadow: '0 0 0 2px rgba(20,184,166,0.2)',
      },
      '.Label': {
        fontWeight: '500',
      },
    },
  };
}

interface PaymentFormProps {
  formattedAmount: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

function PaymentForm({
  formattedAmount,
  amountCents,
  onSuccess,
  onError,
}: PaymentFormProps & { amountCents: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const t = useTranslations('donate');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    setIsSubmitting(true);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/donate` },
      redirect: 'if_required',
    });

    if (error) {
      onError(error.message ?? t('errors.paymentFailed'));
      donateFailed({
        amount_cents: amountCents,
        currency: DONATE_CURRENCY,
        stage: 'payment_confirm',
      });
      setIsSubmitting(false);
    } else {
      onSuccess();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PaymentElement options={{ layout: 'accordion' }} />
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || !stripe || !elements}
        className="w-full h-12 text-base font-semibold bg-[var(--primary-600)] hover:bg-[var(--primary-700)] text-white"
      >
        {isSubmitting
          ? t('payment.submitting')
          : t('payment.submitButton', { amount: formattedAmount })}
      </Button>
    </div>
  );
}

interface Props {
  defaultCompleted?: boolean;
}

export default function DonationPageClient({ defaultCompleted = false }: Props) {
  const t = useTranslations('donate');
  const { resolvedTheme } = useTheme();

  const [step, setStep] = useState<Step>(defaultCompleted ? 'COMPLETED' : 'IDLE');
  const [selectedPreset, setSelectedPreset] = useState<number | null>(25);
  const [customAmount, setCustomAmount] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorMessage, setDonorMessage] = useState('');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amountDollars = isCustom ? parseFloat(customAmount) || 0 : (selectedPreset ?? 0);
  const amountCents = Math.round(amountDollars * 100);
  const amountIsValid = amountCents >= 50;

  const formattedAmount = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amountDollars);

  const handleContinue = useCallback(async () => {
    setError(null);
    if (!amountIsValid) {
      setError(t('errors.minimumAmount'));
      return;
    }
    if (!stripePromise) {
      setError(t('errors.generic'));
      return;
    }

    setStep('LOADING');
    try {
      const res = await fetch('/api/donations/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents,
          donorName: donorName.trim() || undefined,
          donorEmail: donorEmail.trim() || undefined,
          donorMessage: donorMessage.trim().slice(0, 500) || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('errors.generic'));
      }
      const { clientSecret: secret } = await res.json();
      setClientSecret(secret);
      setStep('CHECKOUT');
      donateIntentCreated({ amount_cents: amountCents, currency: DONATE_CURRENCY });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
      setStep('IDLE');
      donateFailed({
        amount_cents: amountCents,
        currency: DONATE_CURRENCY,
        stage: 'intent_create',
      });
    }
  }, [amountCents, amountIsValid, donorEmail, donorMessage, donorName, t]);

  const handleReset = useCallback(() => {
    setStep('IDLE');
    setClientSecret(null);
    setError(null);
    setSelectedPreset(25);
    setCustomAmount('');
    setIsCustom(false);
    setDonorName('');
    setDonorEmail('');
    setDonorMessage('');
  }, []);

  useEffect(() => {
    if (defaultCompleted) {
      setStep('COMPLETED');
      // amount_cents may be unknown here — we landed via Stripe redirect-back
      // with only `payment_intent` in the URL. Falling back to 0 keeps the
      // event firing for funnel-count purposes; PostHog can join the amount
      // from the prior donate_intent_created event in the same session.
      donateCompleted({ amount_cents: amountCents, currency: DONATE_CURRENCY });
    }
    // amountCents is intentionally not in deps — we only fire once on mount
    // when defaultCompleted is true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCompleted]);

  if (step === 'COMPLETED') {
    return (
      <Card className="w-full max-w-lg p-8 flex flex-col items-center gap-6 text-center shadow-lg">
        <div className="w-16 h-16 rounded-full bg-[var(--primary-100)] dark:bg-[var(--primary-800)] flex items-center justify-center">
          <Heart
            className="w-8 h-8 text-[var(--primary-700)] dark:text-white"
            fill="currentColor"
          />
        </div>
        <Badge className="bg-[var(--primary-500)] hover:bg-[var(--primary-500)] text-white">
          {t('success.badge')}
        </Badge>
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold">{t('success.headline')}</h2>
          <p className="text-muted-foreground">
            {t('success.message', { name: donorName ? `, ${donorName}` : '' })}
          </p>
          {donorEmail && (
            <p className="text-sm text-muted-foreground mt-1">
              {t('success.receiptNote', { email: donorEmail })}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={handleReset} className="mt-2">
          {t('success.donateAgain')}
        </Button>
      </Card>
    );
  }

  if (step === 'CHECKOUT' && clientSecret && stripePromise) {
    return (
      <Card className="w-full max-w-lg p-6 sm:p-8 flex flex-col gap-5 shadow-lg">
        <button
          onClick={handleReset}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors self-start -mb-1"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('payment.backButton')}
        </button>
        <Elements
          key={resolvedTheme}
          stripe={stripePromise}
          options={{ clientSecret, appearance: getAppearance(resolvedTheme) }}
        >
          <PaymentForm
            formattedAmount={formattedAmount}
            amountCents={amountCents}
            onSuccess={() => {
              setStep('COMPLETED');
              donateCompleted({ amount_cents: amountCents, currency: DONATE_CURRENCY });
            }}
            onError={msg => setError(msg)}
          />
        </Elements>
        {error && <p className="text-sm text-[var(--secondary-500)]">{error}</p>}
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground -mt-1">
          <Lock className="w-3 h-3" />
          {t('payment.secureNote')}
        </p>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-lg p-6 sm:p-8 flex flex-col gap-6 shadow-lg">
      {/* Amount selector */}
      <div className="flex flex-col gap-3">
        <Label className="text-base font-semibold">{t('amounts.label')}</Label>
        <div className="grid grid-cols-3 gap-2">
          {PRESET_AMOUNTS.map(amount => (
            <button
              key={amount}
              type="button"
              onClick={() => {
                setSelectedPreset(amount);
                setIsCustom(false);
                setCustomAmount('');
                setError(null);
                donateAmountSelected({
                  amount_cents: amount * 100,
                  currency: DONATE_CURRENCY,
                  is_custom: false,
                });
              }}
              className={`rounded-xl border-2 py-3 text-base font-semibold transition-all ${
                !isCustom && selectedPreset === amount
                  ? 'border-[var(--primary-500)] bg-[var(--primary-50)] dark:bg-[var(--primary-950)] text-[var(--primary-700)] dark:text-[var(--primary-500)]'
                  : 'border-border hover:border-[var(--primary-300)] dark:hover:border-[var(--primary-500)] text-foreground'
              }`}
            >
              ${amount}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setIsCustom(true);
              setSelectedPreset(null);
              setError(null);
              donateAmountSelected({
                amount_cents: 0,
                currency: DONATE_CURRENCY,
                is_custom: true,
              });
            }}
            className={`rounded-xl border-2 py-3 text-base font-semibold transition-all ${
              isCustom
                ? 'border-[var(--primary-500)] bg-[var(--primary-50)] dark:bg-[var(--primary-950)] text-[var(--primary-700)] dark:text-[var(--primary-500)]'
                : 'border-border hover:border-[var(--primary-300)] dark:hover:border-[var(--primary-500)] text-foreground'
            }`}
          >
            {t('amounts.custom')}
          </button>
        </div>

        {isCustom && (
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
              $
            </span>
            <Input
              type="number"
              min="0.50"
              step="0.01"
              placeholder={t('amounts.customPlaceholder')}
              value={customAmount}
              onChange={e => {
                setCustomAmount(e.target.value);
                setError(null);
              }}
              className="pl-7"
              autoFocus
            />
          </div>
        )}

        {error && <p className="text-sm text-[var(--secondary-500)]">{error}</p>}
      </div>

      {/* Donor info */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="donorName">{t('form.nameLabel')}</Label>
          <Input
            id="donorName"
            placeholder={t('form.namePlaceholder')}
            value={donorName}
            onChange={e => setDonorName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="donorEmail">{t('form.emailLabel')}</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="donorEmail"
              type="email"
              placeholder={t('form.emailPlaceholder')}
              value={donorEmail}
              onChange={e => setDonorEmail(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="donorMessage">{t('form.messageLabel')}</Label>
          <textarea
            id="donorMessage"
            placeholder={t('form.messagePlaceholder')}
            value={donorMessage}
            onChange={e => setDonorMessage(e.target.value)}
            maxLength={500}
            rows={3}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
          />
          {donorMessage.length > 400 && (
            <p className="text-xs text-muted-foreground text-right">{donorMessage.length}/500</p>
          )}
        </div>
      </div>

      {/* Submit */}
      <Button
        onClick={handleContinue}
        disabled={step === 'LOADING' || !amountIsValid}
        className="w-full h-12 text-base font-semibold bg-[var(--primary-600)] hover:bg-[var(--primary-700)] text-white"
      >
        {step === 'LOADING'
          ? t('payment.submitting')
          : amountIsValid
            ? `${t('form.continueButton')} — ${formattedAmount}`
            : t('form.continueButton')}
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground -mt-2">
        <Lock className="w-3 h-3" />
        {t('payment.secureNote')}
      </p>
    </Card>
  );
}
