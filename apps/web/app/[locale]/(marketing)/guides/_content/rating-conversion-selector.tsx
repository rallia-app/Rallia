'use client';

import { useState } from 'react';
import type { Locale } from '@rallia/shared-translations';

type RatingRow = { level: string; ntrp: string };

type CountrySystem = {
  code: string;
  flag: string;
  names: Record<Locale, string>;
  /** Short system name shown after the country name in the selector. */
  systemShort: string;
  rows: ReadonlyArray<RatingRow>;
};

/**
 * Rating → NTRP mappings derived from the official UTR Conversion Chart
 * (Universal Tennis), which Universal Tennis uses internally to onboard
 * players from foreign federations. Bands are intentionally wide — these
 * are approximations to give a starting NTRP, not exact equivalents.
 */
const COUNTRIES: ReadonlyArray<CountrySystem> = [
  {
    code: 'FR',
    flag: '🇫🇷',
    names: { 'en-US': 'France', 'fr-CA': 'France' },
    systemShort: 'FFT',
    rows: [
      { level: 'Non Classé (NC) / 40', ntrp: '1.5 – 2.0' },
      { level: '30/5', ntrp: '2.0' },
      { level: '30/4, 30/3', ntrp: '2.5' },
      { level: '30/2, 30/1', ntrp: '3.0' },
      { level: '30, 15/5', ntrp: '3.5' },
      { level: '15/4, 15/3', ntrp: '4.0' },
      { level: '15/2, 15/1', ntrp: '4.5' },
      { level: '5/6, 4/6', ntrp: '5.0' },
      { level: '3/6, 2/6', ntrp: '5.5' },
      { level: '1/6, 0, −2/6', ntrp: '6.0 – 6.5' },
      { level: '−4/6, −15, −30, Promotion', ntrp: '7.0' },
      { level: '1ʳᵉ série (top 150 national)', ntrp: '7.0' },
    ],
  },
  {
    code: 'BE',
    flag: '🇧🇪',
    names: { 'en-US': 'Belgium', 'fr-CA': 'Belgique' },
    systemShort: 'AFT / Tennis Vlaanderen',
    rows: [
      { level: 'NR (Non Classé)', ntrp: '1.5 – 2.0' },
      { level: 'C +30/2, C +30/4', ntrp: '2.0' },
      { level: 'C +30', ntrp: '2.5' },
      { level: 'C +15/4', ntrp: '3.0' },
      { level: 'C +15/2', ntrp: '3.5' },
      { level: 'C +15', ntrp: '4.0' },
      { level: 'B +4/6', ntrp: '4.5' },
      { level: 'B-2/6, B 0', ntrp: '5.0' },
      { level: 'B-15/1, B-15', ntrp: '5.5' },
      { level: 'B-15/2, B-15/4 (50bis–65bis)', ntrp: '6.0 – 6.5' },
      { level: 'A Nat’l, A Int’l, B-15/4 (23bis–35bis)', ntrp: '7.0' },
    ],
  },
  {
    code: 'CH',
    flag: '🇨🇭',
    names: { 'en-US': 'Switzerland', 'fr-CA': 'Suisse' },
    systemShort: 'Swiss Tennis (R / N)',
    rows: [
      { level: 'NR (Non Classé)', ntrp: '1.5 – 2.0' },
      { level: 'R7', ntrp: '2.0' },
      { level: 'R6', ntrp: '2.5' },
      { level: 'R5', ntrp: '3.0' },
      { level: 'R4', ntrp: '3.5' },
      { level: 'R3', ntrp: '4.0' },
      { level: 'R2', ntrp: '4.5' },
      { level: 'R1', ntrp: '5.0' },
      { level: 'N4', ntrp: '5.5' },
      { level: 'N3', ntrp: '6.0 – 6.5' },
      { level: 'N2, N1', ntrp: '7.0' },
    ],
  },
  {
    code: 'IT',
    flag: '🇮🇹',
    names: { 'en-US': 'Italy', 'fr-CA': 'Italie' },
    systemShort: 'FIT',
    rows: [
      { level: 'NC', ntrp: '2.0 – 3.0' },
      { level: '4.5, 4.4', ntrp: '3.5' },
      { level: '4.3, 4.2', ntrp: '4.0' },
      { level: '4.1, 3.5', ntrp: '4.5' },
      { level: '3.3, 3.2', ntrp: '5.0' },
      { level: '2.8, 2.7', ntrp: '5.5' },
      { level: '2.6, 2.5, 2.4', ntrp: '6.0 – 6.5' },
      { level: '2.3, 2.2, 2.1, Cat. 1', ntrp: '7.0' },
    ],
  },
  {
    code: 'ES',
    flag: '🇪🇸',
    names: { 'en-US': 'Spain', 'fr-CA': 'Espagne' },
    systemShort: 'RFET',
    rows: [
      { level: 'NR', ntrp: '1.5 – 2.0' },
      { level: '3.ᵃ cat. Grupo 1', ntrp: '2.0' },
      { level: '3.ᵃ cat. Grupo 2', ntrp: '2.5' },
      { level: '3.ᵃ cat. Grupo 3 & 4', ntrp: '3.0' },
      { level: '3.ᵃ cat. Grupo 5 & 6', ntrp: '3.5' },
      { level: '3.ᵃ cat. Grupo 7', ntrp: '4.0' },
      { level: '3.ᵃ cat. Grupo 8', ntrp: '4.5' },
      { level: '3.ᵃ cat. Grupo 9', ntrp: '5.0' },
      { level: '3.ᵃ cat. Grupo 10', ntrp: '5.5' },
      { level: 'N° 151 – 300', ntrp: '6.0 – 6.5' },
      { level: 'N° 1 – 150', ntrp: '7.0' },
    ],
  },
  {
    code: 'GB',
    flag: '🇬🇧',
    names: { 'en-US': 'United Kingdom', 'fr-CA': 'Royaume-Uni' },
    systemShort: 'LTA',
    rows: [
      { level: '10', ntrp: '2.0' },
      { level: '9.2, 9.1', ntrp: '2.5' },
      { level: '8.2, 8.1', ntrp: '3.0' },
      { level: '7.2, 7.1', ntrp: '3.5' },
      { level: '6.2, 6.1', ntrp: '4.0' },
      { level: '5.2, 5.1', ntrp: '4.5' },
      { level: '4.2, 4.1', ntrp: '5.0' },
      { level: '3.2, 3.1', ntrp: '5.5' },
      { level: '2.2, 2.1', ntrp: '6.0 – 6.5' },
      { level: '1.2, 1.1', ntrp: '7.0' },
    ],
  },
  {
    code: 'NL',
    flag: '🇳🇱',
    names: { 'en-US': 'Netherlands', 'fr-CA': 'Pays-Bas' },
    systemShort: 'KNLTB',
    rows: [
      { level: 'NR', ntrp: '1.5 – 2.0' },
      { level: 'Cat 9', ntrp: '2.0' },
      { level: 'Cat 8', ntrp: '2.5' },
      { level: 'Cat 7', ntrp: '3.0' },
      { level: 'Cat 6', ntrp: '3.5 – 4.0' },
      { level: 'Cat 5', ntrp: '4.5' },
      { level: 'Cat 4', ntrp: '5.0' },
      { level: 'Cat 3', ntrp: '5.5' },
      { level: 'Cat 2', ntrp: '6.0 – 6.5' },
      { level: 'Cat 1', ntrp: '7.0' },
    ],
  },
  {
    code: 'LU',
    flag: '🇱🇺',
    names: { 'en-US': 'Luxembourg', 'fr-CA': 'Luxembourg' },
    systemShort: 'FLT',
    rows: [
      { level: 'N° 1009 +', ntrp: '2.0' },
      { level: 'N° 497 – 1008', ntrp: '2.5' },
      { level: 'N° 241 – 496', ntrp: '3.0' },
      { level: 'N° 173 – 240', ntrp: '3.5' },
      { level: 'N° 113 – 172', ntrp: '4.0' },
      { level: 'N° 49 – 112', ntrp: '4.5' },
      { level: 'N° 26 – 48', ntrp: '5.0' },
      { level: 'N° 17 – 25', ntrp: '5.5' },
      { level: 'N° 3 – 16', ntrp: '6.0 – 6.5' },
      { level: 'N° 1 – 2', ntrp: '7.0' },
    ],
  },
  {
    code: 'SE',
    flag: '🇸🇪',
    names: { 'en-US': 'Sweden', 'fr-CA': 'Suède' },
    systemShort: 'Tennis Sweden (points)',
    rows: [
      { level: 'NR', ntrp: '1.5 – 3.0' },
      { level: '50 p', ntrp: '3.5' },
      { level: '51 – 60 p', ntrp: '4.0' },
      { level: '61 – 200 p', ntrp: '4.5' },
      { level: '201 – 300 p', ntrp: '5.0' },
      { level: '301 – 400 p', ntrp: '5.5' },
      { level: '401 – 600 p', ntrp: '6.0 – 6.5' },
      { level: 'Above 600 p', ntrp: '7.0' },
    ],
  },
  {
    code: 'MA',
    flag: '🇲🇦',
    names: { 'en-US': 'Morocco', 'fr-CA': 'Maroc' },
    systemShort: 'FRMT',
    rows: [
      { level: 'NR', ntrp: '1.5 – 2.5' },
      { level: '30/2', ntrp: '3.0' },
      { level: '30/1', ntrp: '3.5' },
      { level: '30', ntrp: '4.0' },
      { level: '15/2, 15/4', ntrp: '4.5' },
      { level: '4/6, 15', ntrp: '5.0' },
      { level: '−2/6, 0', ntrp: '5.5' },
      { level: '−30, −15, −4/6', ntrp: '6.0 – 6.5' },
      { level: '1ʳᵉ série', ntrp: '7.0' },
    ],
  },
];

const LABELS: Record<
  Locale,
  { selectLabel: string; ratingHeader: string; ntrpHeader: string; systemPrefix: string }
> = {
  'en-US': {
    selectLabel: 'Pick your country',
    ratingHeader: 'Your rating',
    ntrpHeader: 'NTRP equivalent',
    systemPrefix: 'System:',
  },
  'fr-CA': {
    selectLabel: 'Choisissez votre pays',
    ratingHeader: 'Votre classement',
    ntrpHeader: 'NTRP équivalent',
    systemPrefix: 'Système :',
  },
};

export function RatingConversionSelector({
  locale,
  defaultCode = 'FR',
}: {
  locale: Locale;
  defaultCode?: string;
}) {
  const [code, setCode] = useState(defaultCode);
  const country = COUNTRIES.find(c => c.code === code) ?? COUNTRIES[0];
  const labels = LABELS[locale];

  return (
    <div className="not-prose my-8 rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 px-5 pt-5 pb-4 border-b border-border bg-muted/30">
        <label className="flex flex-col gap-1.5 flex-1 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {labels.selectLabel}
          </span>
          <select
            value={code}
            onChange={e => setCode(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer"
          >
            {COUNTRIES.map(c => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.names[locale]} — {c.systemShort}
              </option>
            ))}
          </select>
        </label>
        <div className="text-xs text-muted-foreground sm:text-right sm:max-w-[40%]">
          <span className="font-medium">{labels.systemPrefix}</span> {country.systemShort}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-5 font-semibold text-foreground">
                {labels.ratingHeader}
              </th>
              <th className="text-left py-3 px-5 font-semibold text-foreground w-40">
                {labels.ntrpHeader}
              </th>
            </tr>
          </thead>
          <tbody>
            {country.rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 last:border-b-0">
                <td className="py-3 px-5 text-muted-foreground">{row.level}</td>
                <td className="py-3 px-5 font-mono font-semibold text-foreground">{row.ntrp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
