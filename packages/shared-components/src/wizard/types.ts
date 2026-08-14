/**
 * The colour subset the wizard chrome needs. Every wizard in the app already
 * builds a superset of this from the theme, so passing its own `colors` object
 * satisfies it structurally.
 */
export interface WizardColors {
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  progressActive: string;
  progressInactive: string;
}
