/* eslint-disable no-irregular-whitespace --
 * The French text uses non-breaking spaces (U+00A0) as required by French
 * typography (before : ; ? and inside guillemets). Intentional. */
import type { Locale } from '@rallia/shared-translations';

/**
 * Conditions générales de participation aux tournois et ligues payants.
 * Source: Jean's Drive doc "Rallia_Conditions_Generales.docx" (2026-08-14),
 * converted per specs/17-leagues-tournaments/participation-consent.md §6:
 * refund window aligned to registration close (matches refund_cutoff_at),
 * non-refundable service fee made explicit, paper-form artifacts dropped.
 *
 * FR is the source language. The EN text is an in-house draft PENDING LEGAL
 * REVIEW alongside the FR (spec §7); neither is linked from the app until the
 * consent feature ships. Version bumps go through lt_participation_terms.
 */
export const participationTerms: Record<Locale, string> = {
  'fr-CA': `
# Conditions générales de participation

**Tournois et ligues Rallia**

Dernière mise à jour : 14 août 2026

En s'inscrivant à une activité Rallia, le participant accepte les conditions suivantes :

- **Admissibilité :** les activités sont ouvertes à toute personne respectant les critères d'inscription. Rallia peut refuser ou annuler une inscription en cas d'information inexacte, de fraude ou de comportement inapproprié.
- **Règlements :** chaque tournoi ou ligue peut comporter des règles spécifiques de pointage, de format ou de classement. Ces règles sont exécutoires et font partie intégrante des présentes conditions.
- **Format flexible :** après la publication des affrontements, les joueurs sont responsables de convenir du lieu, de la date, de l'heure, de la réservation du terrain et du partage des coûts.
- **Terrains :** Rallia ne garantit pas la disponibilité des installations et n'agit pas comme exploitant ou propriétaire des terrains.
- **Arbitrage par les joueurs :** les participants sont responsables du respect des règlements et de la déclaration honnête des résultats.
- **Résultats :** toute déclaration fausse, trompeuse ou frauduleuse peut entraîner la disqualification, la perte des résultats ou l'exclusion.
- **Pouvoir discrétionnaire :** Rallia possède l'autorité finale relativement à l'organisation, aux classements, aux litiges, au pointage, aux forfaits, aux reports, aux sanctions disciplinaires et à l'interprétation des règlements. Les décisions de Rallia sont finales et exécutoires.
- **Respect des décisions :** les participants s'engagent à respecter toute décision rendue par Rallia.
- **Forfaits :** un joueur absent, retardataire ou ne collaborant pas raisonnablement à la planification d'une partie peut être déclaré perdant par forfait.
- **Annulation et remboursement :** le remboursement des frais d'inscription est possible uniquement avant la fermeture des inscriptions. Une fois les inscriptions fermées ou la compétition démarrée, aucun remboursement n'est accordé, peu importe le motif. Les frais de service Rallia ne sont pas remboursables.
- **Météo et force majeure :** Rallia peut reporter, modifier, écourter ou annuler un événement en raison de la météo, d'une fermeture d'installation, d'une panne technologique ou de toute circonstance hors de son contrôle.
- **Modifications :** Rallia peut ajuster le format, les échéanciers, les règlements ou le système de classement afin d'assurer le bon déroulement de la compétition.
- **Code de conduite :** respect, courtoisie, franc-jeu et sécurité sont obligatoires. Le harcèlement, les menaces, la violence, les insultes, la tricherie ou tout comportement antisportif peuvent entraîner l'exclusion immédiate sans remboursement.
- **Communications :** les participants doivent répondre dans des délais raisonnables aux communications liées à leurs parties.
- **Utilisation du nom et des résultats :** Rallia peut publier les noms, résultats, classements, statistiques ainsi que les photos ou vidéos prises dans le cadre de l'événement à des fins opérationnelles ou promotionnelles, conformément à sa [politique de confidentialité](/privacy).
- **Limitation de responsabilité :** Rallia agit uniquement comme organisateur de la compétition et n'est pas responsable des actes des participants, des conflits entre joueurs, de la qualité des installations, des réservations de terrain, des pertes financières, des dommages matériels ou des conséquences découlant d'un report ou d'une annulation.
- **Acceptation :** l'inscription et la participation valent acceptation complète des présentes conditions et de la [décharge de responsabilité Rallia](/liability-waiver).
`,
  'en-US': `
# Participation Terms

**Rallia tournaments and leagues**

Last updated: August 14, 2026

By registering for a Rallia activity, the participant accepts the following terms:

- **Eligibility:** activities are open to anyone meeting the registration criteria. Rallia may refuse or cancel a registration in case of inaccurate information, fraud, or inappropriate behaviour.
- **Rules:** each tournament or league may carry specific scoring, format, or ranking rules. Those rules are binding and form an integral part of these terms.
- **Flexible format:** once matchups are published, players are responsible for agreeing on the venue, date, time, court booking, and cost sharing.
- **Courts:** Rallia does not guarantee facility availability and does not act as operator or owner of the courts.
- **Player-refereed play:** participants are responsible for following the rules and reporting results honestly.
- **Results:** any false, misleading, or fraudulent report may lead to disqualification, forfeiture of results, or exclusion.
- **Discretionary authority:** Rallia holds final authority over organization, standings, disputes, scoring, forfeits, postponements, disciplinary measures, and the interpretation of the rules. Rallia's decisions are final and binding.
- **Compliance with decisions:** participants agree to respect any decision rendered by Rallia.
- **Forfeits:** a player who is absent, late, or does not reasonably cooperate in scheduling a game may be declared the loser by forfeit.
- **Cancellation and refunds:** registration fees are refundable only before registration closes. Once registration has closed or the competition has started, no refund is granted, regardless of the reason. Rallia service fees are non-refundable.
- **Weather and force majeure:** Rallia may postpone, modify, shorten, or cancel an event due to weather, facility closure, technological failure, or any circumstance beyond its control.
- **Changes:** Rallia may adjust the format, schedule, rules, or ranking system to ensure the competition runs properly.
- **Code of conduct:** respect, courtesy, fair play, and safety are mandatory. Harassment, threats, violence, insults, cheating, or any unsportsmanlike behaviour may lead to immediate exclusion without refund.
- **Communications:** participants must respond within a reasonable time to communications about their games.
- **Use of name and results:** Rallia may publish names, results, standings, statistics, and photos or videos taken during the event for operational or promotional purposes, in accordance with its [privacy policy](/privacy).
- **Limitation of liability:** Rallia acts solely as the organizer of the competition and is not responsible for the acts of participants, conflicts between players, the quality of facilities, court bookings, financial losses, property damage, or the consequences of a postponement or cancellation.
- **Acceptance:** registering and participating constitute full acceptance of these terms and of the [Rallia liability waiver](/liability-waiver).
`,
};
