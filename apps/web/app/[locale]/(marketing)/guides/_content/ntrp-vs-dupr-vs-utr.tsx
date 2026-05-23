import Link from 'next/link';

import type { Guide } from './types';

const SYSTEMS_EN: Array<[string, string, string, string]> = [
  ['Scale', '1.0–7.0', '1.0–16.5', '2.0–8.0'],
  [
    'How it’s calculated',
    'Self-rated (or USTA computer)',
    'Algorithm from match results',
    'Algorithm from match results',
  ],
  ['Updates', 'Yearly (USTA computer)', 'After every match', 'After every match'],
  [
    'Best for',
    'Casual / USTA leagues',
    'Tournaments, college recruiting',
    'Pickleball + modern tennis',
  ],
  ['Geography', 'Mostly USA + Canada', 'Global, USA-heavy', 'Global, fastest in pickleball'],
];

const SYSTEMS_FR: Array<[string, string, string, string]> = [
  ['Échelle', '1,0–7,0', '1,0–16,5', '2,0–8,0'],
  [
    'Calcul',
    'Auto-évaluation (ou par ordinateur USTA)',
    'Algorithme sur les résultats de matchs',
    'Algorithme sur les résultats de matchs',
  ],
  ['Mise à jour', 'Annuelle (système USTA)', 'Après chaque match', 'Après chaque match'],
  [
    'Idéal pour',
    'Récréatif / ligues USTA',
    'Tournois, recrutement universitaire',
    'Pickleball + tennis moderne',
  ],
  [
    'Présence',
    'Surtout É.-U. + Canada',
    'Mondiale, dominante aux É.-U.',
    'Mondiale, croissance la plus rapide en pickleball',
  ],
];

function TableEN() {
  return (
    <div className="overflow-x-auto my-8">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 font-semibold"></th>
            <th className="text-left py-3 px-4 font-semibold">NTRP</th>
            <th className="text-left py-3 px-4 font-semibold">UTR</th>
            <th className="text-left py-3 px-4 font-semibold">DUPR</th>
          </tr>
        </thead>
        <tbody>
          {SYSTEMS_EN.map(([label, a, b, c]) => (
            <tr key={label} className="border-b border-border/50">
              <td className="py-3 px-4 font-semibold">{label}</td>
              <td className="py-3 px-4 text-muted-foreground">{a}</td>
              <td className="py-3 px-4 text-muted-foreground">{b}</td>
              <td className="py-3 px-4 text-muted-foreground">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableFR() {
  return (
    <div className="overflow-x-auto my-8">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 font-semibold"></th>
            <th className="text-left py-3 px-4 font-semibold">NTRP</th>
            <th className="text-left py-3 px-4 font-semibold">UTR</th>
            <th className="text-left py-3 px-4 font-semibold">DUPR</th>
          </tr>
        </thead>
        <tbody>
          {SYSTEMS_FR.map(([label, a, b, c]) => (
            <tr key={label} className="border-b border-border/50">
              <td className="py-3 px-4 font-semibold">{label}</td>
              <td className="py-3 px-4 text-muted-foreground">{a}</td>
              <td className="py-3 px-4 text-muted-foreground">{b}</td>
              <td className="py-3 px-4 text-muted-foreground">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const ntrpVsDuprVsUtr: Guide = {
  meta: {
    slug: 'ntrp-vs-dupr-vs-utr',
    publishedAt: '2026-05-22',
    sports: ['tennis', 'pickleball'],
    image: {
      src: '/guides/ntrp-vs-dupr-vs-utr.jpg',
      width: 1600,
      height: 1067,
      credit: {
        name: 'Aleksander Saks',
        url: 'https://unsplash.com/photos/two-paddles-and-three-balls-on-a-tennis-court-KO6QJcddk28',
      },
    },
  },
  content: {
    'en-US': {
      title: 'NTRP vs DUPR vs UTR: Which Tennis Rating System Should You Use?',
      description:
        'NTRP is self-rated and great for casual play. UTR is calculated from match results and used by college coaches. DUPR is modern and dominant in pickleball. Here’s how to pick.',
      ogTitle: 'NTRP vs DUPR vs UTR — Which Rating System Should You Use?',
      ogDescription:
        'A side-by-side breakdown of the three rating systems, when each one matters, and how to convert between them.',
      heading: 'NTRP vs DUPR vs UTR: Which Tennis Rating System Should You Use?',
      leadAnswer:
        'NTRP is self-rated and used by USTA leagues — best for casual play. UTR is calculated from match results, ranges from 1 to 16.5, and is the system college coaches use. DUPR is algorithmic, updates after every match, and dominates pickleball. Pick by context: NTRP for league play, UTR for tournaments, DUPR for pickleball or modern tennis matchmaking.',
      imageAlt: 'Two pickleball paddles and three balls arranged on an outdoor court.',
      body: (
        <>
          <h2>The Three Systems at a Glance</h2>
          <TableEN />

          <h2>NTRP: The Self-Rated Classic</h2>
          <p>
            The National Tennis Rating Program (NTRP) was developed by the USTA in 1979. It’s the
            oldest and most widely recognized system in North American recreational tennis. Players
            rate themselves on a 1.0–7.0 scale in half-point increments based on descriptive
            criteria — how consistent your strokes are, whether you have shot variety, how you
            adjust tactically.
          </p>
          <p>
            <strong>Strengths:</strong> simple, descriptive, doesn’t require a tracked history of
            matches. Good enough for casual sorting.
          </p>
          <p>
            <strong>Weaknesses:</strong> self-rated players consistently over-rate themselves by
            about half a point. The USTA computer-calculated rating fixes this for league players
            but only updates once a year.
          </p>
          <p>
            We have a full breakdown in our{' '}
            <Link href="/en-US/guides/ntrp-rating-explained">NTRP Rating System Explained</Link>{' '}
            guide.
          </p>

          <h2>UTR: The Match-Result System</h2>
          <p>
            Universal Tennis Rating (UTR) is a global rating calculated entirely from match results.
            It runs from about 1.0 to 16.5 with decimal precision (e.g. 7.42). It’s the system
            college coaches scout from, the system used in many tournaments, and the system that
            crosses junior, college, and adult tennis in a single number.
          </p>
          <p>
            <strong>Strengths:</strong> objective, recalculated after every recorded match,
            internationally consistent, ignores age and gender so a 17-year-old girl with UTR 8.5
            and a 45-year-old man with UTR 8.5 are roughly equivalent matchups.
          </p>
          <p>
            <strong>Weaknesses:</strong> only works if your matches are reported. Casual rec play
            usually isn’t. If you’re not playing tournaments or sanctioned events, your UTR will
            either be inactive or stale.
          </p>

          <h2>DUPR: The Modern, Always-On Rating</h2>
          <p>
            Dynamic Universal Pickleball Rating (DUPR) started in pickleball but is now expanding
            into tennis. It uses a 2.0–8.0 scale (so a 4.0 DUPR ≠ 4.0 NTRP) and recalculates after
            every match — even informal recreational ones, if both players agree to record the
            result.
          </p>
          <p>
            <strong>Strengths:</strong> updates fastest, treats men and women equally, factors in
            score margins (a 11-2 win counts more than 11-9), and the official rating used by most
            modern pickleball tournaments.
          </p>
          <p>
            <strong>Weaknesses:</strong> requires you (and your partner / opponents) to actually log
            matches. If you’re used to never tracking results, this takes friction to start.
          </p>

          <h2>Which One to Use — A Decision Tree</h2>
          <ul>
            <li>
              <strong>I play USTA leagues:</strong> NTRP is mandatory there. UTR is a useful
              secondary number.
            </li>
            <li>
              <strong>I want to compete in tournaments or get college scouted:</strong> UTR is the
              system that matters. Track it.
            </li>
            <li>
              <strong>I play pickleball seriously:</strong> DUPR. It’s the de facto standard.
            </li>
            <li>
              <strong>I just want to find recreational partners at my level:</strong> A
              self-assigned NTRP is enough. Use your roughly-honest number when joining games and
              refine over time.
            </li>
            <li>
              <strong>I play both tennis and pickleball:</strong> DUPR works for both. UTR if you
              also want a tennis-specific competitive number.
            </li>
          </ul>

          <h2>Can You Convert Between Them?</h2>
          <p>
            Roughly, yes — but the conversion is approximate because the systems measure different
            things. Here are commonly cited equivalences for tennis:
          </p>
          <ul>
            <li>NTRP 3.0 ≈ UTR 1–3 ≈ DUPR 3.0–3.5</li>
            <li>NTRP 3.5 ≈ UTR 3–5 ≈ DUPR 3.5–4.0</li>
            <li>NTRP 4.0 ≈ UTR 5–7 ≈ DUPR 4.0–4.5</li>
            <li>NTRP 4.5 ≈ UTR 7–9 ≈ DUPR 4.5–5.0</li>
            <li>NTRP 5.0+ ≈ UTR 9+ ≈ DUPR 5.0+</li>
          </ul>
          <p>
            Take the ranges with a grain of salt. The right way to think about this: NTRP gives you
            a self-assessed bucket, UTR and DUPR refine that bucket using actual data.
          </p>

          <h2>What This Means for Finding Players</h2>
          <p>
            Most matchmaking platforms — including Rallia — let you set a rating in one or more
            systems and match against players within a tight band. The honest play is to start with
            an accurate self-rated NTRP and let actual match results adjust you over time. Picking a
            high number to look good means you’ll lose every game and stop playing. Picking a low
            number to dominate means everyone else has a miserable time and you stop getting
            invites.
          </p>
          <p>
            Whichever system you pick, the rating is just the starting filter. Showing up, being
            reliable, and playing within yourself is what builds a partner network.
          </p>

          <h2>Get Matched at Your Level on Rallia</h2>
          <p>
            Rallia uses your self-rated NTRP (and DUPR if you play pickleball) to surface games with
            players in your skill band. Over time, your rating adjusts based on verified results —
            so the matches you see stay closer to your actual level as you play.
          </p>
        </>
      ),
    },
    'fr-CA': {
      title: 'NTRP, DUPR ou UTR : quel système de classement choisir au tennis et au pickleball ?',
      description:
        'Le NTRP est auto-évalué et parfait pour le récréatif. L’UTR se calcule à partir des résultats de matchs et est utilisé par les entraîneurs universitaires. Le DUPR domine le pickleball moderne. Voici comment choisir.',
      ogTitle: 'NTRP, DUPR ou UTR — quel système de classement utiliser ?',
      ogDescription:
        'Comparaison côte à côte des trois systèmes, à quoi sert chacun, et comment convertir entre eux.',
      heading:
        'NTRP, DUPR ou UTR : quel système de classement choisir au tennis et au pickleball ?',
      leadAnswer:
        'Le NTRP est auto-évalué et utilisé par les ligues USTA — idéal pour le récréatif. L’UTR est calculé à partir des résultats de matchs, va de 1 à 16,5 et c’est le système qu’utilisent les entraîneurs universitaires. Le DUPR est algorithmique, mis à jour après chaque match, et domine le pickleball. Choisissez selon le contexte&nbsp;: NTRP pour la ligue, UTR pour les tournois, DUPR pour le pickleball ou le tennis moderne.',
      imageAlt: 'Deux raquettes de pickleball et trois balles disposées sur un terrain extérieur.',
      body: (
        <>
          <h2>Les trois systèmes en un coup d’œil</h2>
          <TableFR />

          <h2>NTRP : le classique auto-évalué</h2>
          <p>
            Le National Tennis Rating Program (NTRP) a été développé par la USTA en 1979. C’est le
            système le plus ancien et le plus reconnu dans le tennis récréatif nord-américain. Les
            joueurs s’auto-évaluent sur une échelle de 1,0 à 7,0 par incréments d’un demi-point en
            fonction de critères descriptifs — régularité des coups, variété de jeu, ajustement
            tactique.
          </p>
          <p>
            <strong>Forces&nbsp;:</strong> simple, descriptif, ne demande pas d’historique de
            matchs. Suffisant pour le tri récréatif.
          </p>
          <p>
            <strong>Faiblesses&nbsp;:</strong> les joueurs qui s’auto-évaluent se surévaluent
            régulièrement d’environ un demi-point. Le classement calculé par ordinateur de la USTA
            corrige cela pour les joueurs de ligue, mais ne se met à jour qu’une fois par année.
          </p>
          <p>
            Notre guide{' '}
            <Link href="/fr-CA/guides/ntrp-rating-explained">
              Le système de classement NTRP expliqué
            </Link>{' '}
            couvre tous les détails.
          </p>

          <h2>UTR : le système basé sur les résultats</h2>
          <p>
            Universal Tennis Rating (UTR) est un classement mondial calculé entièrement à partir des
            résultats de matchs. Il va d’environ 1,0 à 16,5 avec une précision décimale (par exemple
            7,42). C’est le système qu’utilisent les entraîneurs universitaires pour recruter, qui
            sert dans de nombreux tournois, et qui relie le tennis junior, universitaire et adulte
            en un seul chiffre.
          </p>
          <p>
            <strong>Forces&nbsp;:</strong> objectif, recalculé après chaque match enregistré,
            cohérent à l’international, ignore l’âge et le genre — donc une joueuse de 17&nbsp;ans
            avec un UTR de 8,5 et un homme de 45&nbsp;ans avec un UTR de 8,5 sont à peu près
            équivalents sur le terrain.
          </p>
          <p>
            <strong>Faiblesses&nbsp;:</strong> ne fonctionne que si vos matchs sont rapportés. Le
            jeu récréatif ne l’est généralement pas. Si vous ne jouez pas en tournoi ou en événement
            sanctionné, votre UTR sera inactif ou désuet.
          </p>

          <h2>DUPR : le classement moderne et toujours à jour</h2>
          <p>
            Dynamic Universal Pickleball Rating (DUPR) a commencé en pickleball mais s’étend
            maintenant au tennis. Il utilise une échelle de 2,0 à 8,0 (donc un DUPR de 4,0 ≠ NTRP
            4,0) et se recalcule après chaque match — même les parties récréatives informelles, si
            les deux joueurs acceptent d’enregistrer le résultat.
          </p>
          <p>
            <strong>Forces&nbsp;:</strong> mises à jour les plus rapides, traite hommes et femmes de
            la même manière, tient compte de l’écart de score (un gain 11-2 compte plus qu’un gain
            11-9), et c’est le classement officiel utilisé par la plupart des tournois de pickleball
            modernes.
          </p>
          <p>
            <strong>Faiblesses&nbsp;:</strong> exige que vous (et vos partenaires / adversaires)
            consigniez réellement les matchs. Si vous n’avez jamais l’habitude d’enregistrer vos
            résultats, il y a un peu de friction au départ.
          </p>

          <h2>Lequel utiliser&nbsp;? Un arbre de décision</h2>
          <ul>
            <li>
              <strong>Je joue en ligue USTA&nbsp;:</strong> le NTRP est obligatoire. L’UTR est un
              chiffre secondaire utile.
            </li>
            <li>
              <strong>Je veux compétitionner en tournoi ou être recruté&nbsp;:</strong> l’UTR est le
              système qui compte. Suivez-le.
            </li>
            <li>
              <strong>Je joue au pickleball sérieusement&nbsp;:</strong> DUPR. C’est la norme de
              facto.
            </li>
            <li>
              <strong>
                Je veux simplement trouver des partenaires récréatifs de mon niveau&nbsp;:
              </strong>{' '}
              un NTRP auto-évalué honnêtement suffit. Utilisez votre chiffre approximatif pour
              joindre des parties et raffinez-le avec le temps.
            </li>
            <li>
              <strong>Je joue au tennis et au pickleball&nbsp;:</strong> DUPR fonctionne pour les
              deux. Ajoutez un UTR si vous voulez aussi un chiffre compétitif spécifique au tennis.
            </li>
          </ul>

          <h2>Peut-on convertir d’un système à l’autre&nbsp;?</h2>
          <p>
            En gros, oui — mais la conversion est approximative parce que les systèmes mesurent des
            choses différentes. Voici les équivalences couramment citées pour le tennis&nbsp;:
          </p>
          <ul>
            <li>NTRP 3,0 ≈ UTR 1–3 ≈ DUPR 3,0–3,5</li>
            <li>NTRP 3,5 ≈ UTR 3–5 ≈ DUPR 3,5–4,0</li>
            <li>NTRP 4,0 ≈ UTR 5–7 ≈ DUPR 4,0–4,5</li>
            <li>NTRP 4,5 ≈ UTR 7–9 ≈ DUPR 4,5–5,0</li>
            <li>NTRP 5,0+ ≈ UTR 9+ ≈ DUPR 5,0+</li>
          </ul>
          <p>
            Prenez ces fourchettes avec un grain de sel. La bonne façon d’y penser&nbsp;: le NTRP
            vous donne une catégorie auto-évaluée, l’UTR et le DUPR la raffinent avec des données
            réelles.
          </p>

          <h2>Ce que ça implique pour trouver des joueurs</h2>
          <p>
            La plupart des plateformes de jumelage — incluant Rallia — vous laissent inscrire un
            classement dans un ou plusieurs systèmes et vous jumellent avec des joueurs dans une
            fourchette serrée. La bonne stratégie&nbsp;: commencez avec un NTRP auto-évalué honnête,
            et laissez vos résultats ajuster votre niveau avec le temps. Choisir un chiffre élevé
            pour avoir l’air bon vous fera perdre toutes vos parties et vous arrêterez de jouer.
            Choisir un chiffre bas pour dominer rendra tout le monde misérable et vous cesserez de
            recevoir des invitations.
          </p>
          <p>
            Quel que soit le système choisi, le classement n’est que le filtre de départ. Se
            présenter, être fiable et jouer dans ses moyens — voilà ce qui bâtit un réseau de
            partenaires.
          </p>

          <h2>Soyez jumelé à votre niveau sur Rallia</h2>
          <p>
            Rallia utilise votre NTRP auto-évalué (et votre DUPR si vous jouez au pickleball) pour
            faire apparaître les parties avec des joueurs de votre catégorie. Avec le temps, votre
            classement s’ajuste selon vos résultats vérifiés — pour que les parties qu’on vous
            présente restent proches de votre vrai niveau.
          </p>
        </>
      ),
    },
  },
};
