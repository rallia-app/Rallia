import type { Guide } from './types';
import { findTennisPickleballPartner } from './find-tennis-pickleball-partner';
import { ntrpRatingExplained } from './ntrp-rating-explained';
import { ntrpVsDuprVsUtr } from './ntrp-vs-dupr-vs-utr';
import { pickleballRulesBeginners } from './pickleball-rules-beginners';
import { tennisCourtEtiquette } from './tennis-court-etiquette';

/**
 * Add new guides here. Order controls index-page sort
 * (most prominent first).
 */
const GUIDES: ReadonlyArray<Guide> = [
  findTennisPickleballPartner,
  ntrpRatingExplained,
  ntrpVsDuprVsUtr,
  pickleballRulesBeginners,
  tennisCourtEtiquette,
];

export function getAllGuides(): ReadonlyArray<Guide> {
  return GUIDES;
}

export function getGuideBySlug(slug: string): Guide | undefined {
  return GUIDES.find(g => g.meta.slug === slug);
}

export function getAllGuideSlugs(): ReadonlyArray<string> {
  return GUIDES.map(g => g.meta.slug);
}
