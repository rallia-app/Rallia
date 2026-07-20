import { describe, it, expect } from '@jest/globals';

import { typography } from '../theme';

import { getLineHeight, getFontSize } from './Text';

const SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'] as const;

describe('Text line height', () => {
  it('scales with an explicit size', () => {
    // Regression: every sized Text used to inherit the body variant's fixed
    // 24px box, so a 30px glyph was clipped at the top.
    expect(getLineHeight(undefined, undefined, getFontSize('3xl'))).toBe(45);
    expect(getLineHeight(undefined, undefined, getFontSize('2xl'))).toBe(36);
  });

  it('never resolves smaller than the font size', () => {
    for (const size of SIZES) {
      const fontSize = getFontSize(size);
      expect(getLineHeight(undefined, undefined, fontSize)).toBeGreaterThanOrEqual(fontSize);
    }
  });

  it('tightens small text to the same ratio as everything else', () => {
    expect(getLineHeight(undefined, undefined, getFontSize('sm'))).toBe(21);
    expect(getLineHeight(undefined, undefined, getFontSize('xs'))).toBe(18);
  });

  it('leaves the variant defaults at their pre-fix absolutes', () => {
    // Variants carry a ratio now, but must resolve to the same numbers they did
    // before at their own font sizes.
    expect(getLineHeight(undefined, 'body', getFontSize('base'))).toBe(24);
    expect(getLineHeight(undefined, undefined, getFontSize('base'))).toBe(24);
    expect(getLineHeight(undefined, 'caption', getFontSize('sm'))).toBe(21);
    expect(getLineHeight(undefined, 'label', getFontSize('sm'))).toBe(17.5);
  });

  it('honours an explicit lineHeight over the variant ratio', () => {
    expect(getLineHeight('tight', undefined, 30)).toBe(30 * typography.lineHeight.tight);
    expect(getLineHeight('relaxed', undefined, 30)).toBe(30 * typography.lineHeight.relaxed);
    // Also overrides a variant that would otherwise be tight.
    expect(getLineHeight('relaxed', 'label', 14)).toBe(14 * typography.lineHeight.relaxed);
  });

  it('applies the ratio to a numeric size too', () => {
    expect(getFontSize(40)).toBe(40);
    expect(getLineHeight(undefined, undefined, 40)).toBe(60);
  });
});

describe('getFontSize', () => {
  it('resolves tokens and falls back to base', () => {
    expect(getFontSize('3xl')).toBe(30);
    expect(getFontSize('base')).toBe(16);
    expect(getFontSize(undefined)).toBe(16);
  });
});
