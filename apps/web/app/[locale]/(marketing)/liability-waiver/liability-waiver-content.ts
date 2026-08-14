/* eslint-disable no-irregular-whitespace --
 * The French text uses non-breaking spaces (U+00A0) as required by French
 * typography (before : ; ? and inside guillemets). Intentional. */
import type { Locale } from '@rallia/shared-translations';

/**
 * Décharge de responsabilité et acceptation des risques.
 * Source: Jean's Drive doc "Rallia_Decharge_Responsabilite.docx" (2026-08-14),
 * converted per specs/17-leagues-tournaments/participation-consent.md §6: the
 * paper signature block (Nom / Signature / Date) is dropped, acceptance is the
 * timestamped consent recorded at registration.
 *
 * FR is the source language. The EN text is an in-house draft PENDING LEGAL
 * REVIEW alongside the FR (spec §7); neither is linked from the app until the
 * consent feature ships. Version bumps go through lt_participation_terms.
 */
export const liabilityWaiver: Record<Locale, string> = {
  'fr-CA': `
# Décharge de responsabilité et acceptation des risques

**Rallia**

Dernière mise à jour : 14 août 2026

**Veuillez lire attentivement.** En m'inscrivant à une activité Rallia et en y participant, je reconnais et accepte ce qui suit :

- Ma participation est volontaire.
- Le tennis, le pickleball et les activités sportives comportent des risques inhérents pouvant notamment inclure blessures, chutes, entorses, fractures, déshydratation, coups de balle ou aggravation d'une condition médicale préexistante.
- Je confirme être physiquement apte à participer et j'assume la responsabilité de consulter un professionnel de la santé au besoin.
- Je demeure responsable de ma sécurité, de mon équipement, de mes déplacements et de mes décisions durant l'activité.
- Je reconnais que les parties se déroulent sur des installations exploitées par des tiers et que Rallia n'en contrôle pas nécessairement l'état, la disponibilité ou la sécurité.
- Je comprends que les participants sont responsables de coordonner leurs parties, leurs réservations et leurs frais de terrain.
- Dans toute la mesure permise par la loi, je libère et dégage Rallia, ses administrateurs, dirigeants, employés, bénévoles, partenaires, commanditaires, représentants et sociétés affiliées de toute réclamation, perte, dommage, blessure, coût ou dépense découlant directement ou indirectement de ma participation.
- J'accepte d'assumer personnellement les conséquences financières, médicales et matérielles liées à ma participation.
- Je renonce à toute réclamation fondée sur les actes ou omissions d'autres participants ou de tiers.
- Je reconnais que la présente décharge ne limite pas les responsabilités qui ne peuvent être exclues en vertu des lois applicables du Québec.
- J'accepte de respecter les règlements, directives et décisions de Rallia, incluant les [conditions générales de participation](/participation-terms).
- Je confirme avoir lu, compris et accepté librement la présente décharge.

L'acceptation de la présente décharge est enregistrée au moment de l'inscription, avec la date et la version acceptées.
`,
  'en-US': `
# Waiver of Liability and Acceptance of Risks

**Rallia**

Last updated: August 14, 2026

**Please read carefully.** By registering for and taking part in a Rallia activity, I acknowledge and accept the following:

- My participation is voluntary.
- Tennis, pickleball, and sporting activities carry inherent risks, which may include injuries, falls, sprains, fractures, dehydration, being struck by a ball, or the aggravation of a pre-existing medical condition.
- I confirm that I am physically fit to participate, and I take responsibility for consulting a healthcare professional as needed.
- I remain responsible for my safety, my equipment, my travel, and my decisions during the activity.
- I acknowledge that games take place at facilities operated by third parties and that Rallia does not necessarily control their condition, availability, or safety.
- I understand that participants are responsible for coordinating their games, bookings, and court fees.
- To the fullest extent permitted by law, I release and discharge Rallia, its directors, officers, employees, volunteers, partners, sponsors, representatives, and affiliated companies from any claim, loss, damage, injury, cost, or expense arising directly or indirectly from my participation.
- I agree to personally assume the financial, medical, and material consequences of my participation.
- I waive any claim based on the acts or omissions of other participants or third parties.
- I acknowledge that this waiver does not limit liabilities that cannot be excluded under the applicable laws of Quebec.
- I agree to respect Rallia's rules, directives, and decisions, including the [participation terms](/participation-terms).
- I confirm that I have read, understood, and freely accepted this waiver.

Acceptance of this waiver is recorded at registration, together with the date and the version accepted.
`,
};
