import { RatingConversionSelector } from './rating-conversion-selector';
import type { Guide } from './types';

type NtrpRow =
  | { level: string; kind: 'detailed'; ground: string; ret: string; net: string; serve: string }
  | { level: string; kind: 'summary'; summary: string };

const NTRP_ROWS_EN: ReadonlyArray<NtrpRow> = [
  {
    level: '1.0',
    kind: 'summary',
    summary: 'Just learning to swing the racquet and make contact. No real strokes yet.',
  },
  {
    level: '1.5',
    kind: 'summary',
    summary:
      'Has hit a few balls. Still struggles to keep a baseline rally going; the serve is unreliable.',
  },
  {
    level: '2.0',
    kind: 'detailed',
    ground:
      'Can keep a slow rally going on easy balls. Forehand is much stronger than the backhand — players at this level actively run around their backhand.',
    ret: 'Returns only on easy serves. Anything paced gets missed or popped up short.',
    net: 'Avoids the net. Comfortable only on soft balls; the backhand volley and overhead are unreliable.',
    serve: 'Frequent double faults. The toss is usually the main problem.',
  },
  {
    level: '2.5',
    kind: 'detailed',
    ground:
      'Can sustain a 10-shot rally at moderate pace using mostly the forehand. Ball trajectory is flat and pace is modest.',
    ret: 'Returns toward the middle of the court in singles. Struggles to return crosscourt in doubles.',
    net: 'Comes to the net in practice but hesitates to do it in matches.',
    serve: 'First serve goes in less than half the time. Second serve is just a “put it in play.”',
  },
  {
    level: '3.0',
    kind: 'detailed',
    ground:
      'Sustains 10-shot rallies more confidently on the forehand than the backhand. Struggles with high, short, or wide balls on the dominant side at moderate pace.',
    ret: 'Returns moderate-paced serves with deliberate intent in both singles and doubles.',
    net: 'Solid forehand volley on easy balls; the backhand volley is still shaky. Hits easy overheads but not while moving.',
    serve: 'First serve in more than 50% of the time. Second serve is noticeably slower.',
  },
  {
    level: '3.5',
    kind: 'detailed',
    ground:
      'Can move the opponent side-to-side and attack weaker balls with controlled power. Wins more than half their approach-shot points.',
    ret: 'Defends against fast or wide serves; attacks weak second serves with power.',
    net: 'Forehand volley has direction. Backhand volley and overheads-under-movement are still inconsistent.',
    serve:
      'Varies pace or direction on the first serve. Targets the second serve at the opponent’s weaker side. Double faults are rare.',
  },
  {
    level: '4.0',
    kind: 'detailed',
    ground:
      'Constructs points reliably with shot variety. Less reliable under pressure — fast or wide balls, or against an equal-level opponent.',
    ret: 'Dependable return with slice or topspin. Uses returns to seize point control and exploit weaknesses. Strong, reliable return-of-serve in doubles.',
    net: 'Comfortable at the net in singles. Aggressive doubles net play with shot variety. Puts away easy overheads.',
    serve: 'Hits with control and depth on the first serve. Uses spin variation.',
  },
  {
    level: '4.5',
    kind: 'detailed',
    ground:
      'Uses multiple spins; developing either a clear weapon or strong overall consistency. Has trouble with two of three: fast balls, wide balls, or sharp angles, against equal opposition.',
    ret: 'Returns first serves reliably; aggressive return attempts succeed under 30% of the time. In doubles, the return is stronger but still under 50% reliable.',
    net: 'Comfortable with serve-and-volley. Hits deep approach volleys; struggles when the ball arrives with real pace or angle. Can finish with angles, drops, or punches.',
    serve:
      'First serve is powerful or heavily spun. Second serve usually lands close and deep. Few double faults. In doubles, follows the first serve to the net, but errors still happen.',
  },
  {
    level: '5.0',
    kind: 'detailed',
    ground:
      'Constructs 10-shot doubles rallies confidently. Puts away short balls cleanly. Wins about half their counter-attacks even on tough balls — fast, wide, or against equal opposition.',
    ret: 'Returns about half of all non-weapon first serves with quality. In doubles, can deliberately direct returns toward the opponent’s weakness.',
    net: 'Strong singles and doubles net play. Aggressive in depth and drops. Overheads work from anywhere on the court.',
    serve:
      'Effective first serve on placement, pace, and spin. Quality second serve limits the opponent’s attack window. Service-and-volley pattern is sharp in doubles.',
  },
  {
    level: '5.5',
    kind: 'summary',
    summary:
      'Has developed an identifiable style: baseline attacker, all-court player, serve-and-volleyer, or counter-puncher. Strong anticipation (reading the opponent’s serve and positioning) and tactics (adapting mid-match). No major weaknesses. Counter-attacks deep balls against equal-level opposition. Eligible for provincial open tournaments. Exploits weaknesses with shot variety: drops, lobs, angles, slow balls.',
  },
  {
    level: '6.0–7.0',
    kind: 'summary',
    summary:
      'Self-rating no longer applies — official rankings do. 6.0 has trained intensively with a competitive career at junior, college, or post-college level. 6.5 has solid experience on international open tournaments (Futures, Challengers). 7.0 is a touring professional at the international level.',
  },
];

const NTRP_ROWS_FR: ReadonlyArray<NtrpRow> = [
  {
    level: '1,0',
    kind: 'summary',
    summary:
      'Le joueur apprend le mouvement de la raquette et le contact avec la balle. Pas encore de véritables coups.',
  },
  {
    level: '1,5',
    kind: 'summary',
    summary:
      'A frappé quelques balles, mais éprouve encore de la difficulté à maintenir un échange en fond de terrain ; le service est aléatoire.',
  },
  {
    level: '2,0',
    kind: 'detailed',
    ground:
      'Arrive à échanger en fond de terrain sur des balles faciles. Constance limitée par le manque de contrôle. Évite souvent le revers au profit du coup droit.',
    ret: 'Retourne uniquement les services lents ; les services à vitesse normale lui posent problème.',
    net: 'Évite le filet. À l’aise seulement sur les balles faibles ; la volée du revers et le smash sont peu fiables.',
    serve: 'Doubles fautes fréquentes. Le lancer de balle reste le principal problème.',
  },
  {
    level: '2,5',
    kind: 'detailed',
    ground:
      'Réussit des échanges de 10 coups en fond de terrain, surtout en coup droit. Trajectoire plate, vitesse modérée.',
    ret: 'En simple, retourne vers le centre du terrain. En double, éprouve de la difficulté à retourner en croisé.',
    net: 'Monte au filet à l’entraînement, mais hésite à le faire en match.',
    serve:
      'Premier service réussi à moins de 50 %. Le deuxième service se limite à une « mise en jeu ».',
  },
  {
    level: '3,0',
    kind: 'detailed',
    ground:
      'Réussit des échanges de 10 coups, avec plus d’aisance en coup droit qu’en revers. À cadence modérée, retourne les balles hautes, courtes ou éloignées avec plus de difficulté sur son côté dominant.',
    ret: 'Sur un service à vitesse modérée, contrôle son retour avec une intention précise, en simple comme en double.',
    net: 'Bonne volée du coup droit sur balle facile ; la volée du revers reste problématique. Smash sur balles faciles seulement.',
    serve: 'Premier service réussi à plus de 50 %. Deuxième service plus lent.',
  },
  {
    level: '3,5',
    kind: 'detailed',
    ground:
      'Peut déplacer l’adversaire latéralement et attaquer les balles faibles avec une puissance contrôlée. Réussit plus de 50 % de ses coups d’approche.',
    ret: 'Retourne défensivement les services rapides ou éloignés. Sur une deuxième balle faible, retourne en puissance ou en attaque.',
    net: 'Volée du coup droit dirigée. Volée du revers et smashs en déplacement court restent inconsistants.',
    serve:
      'Varie la vitesse ou la direction du premier service. Peut diriger le deuxième service vers la faiblesse de l’adversaire. Doubles fautes peu fréquentes.',
  },
  {
    level: '4,0',
    kind: 'detailed',
    ground:
      'Construit ses points de façon constante avec une bonne variété de coups. Moins fiable sous pression : balles rapides, éloignées, ou face à un adversaire de niveau égal.',
    ret: 'Retour fiable, en coupé ou en lifté. Utilise le retour pour prendre l’initiative et exploiter les faiblesses adverses. Retour solide et constant en double.',
    net: 'À l’aise au filet en simple. En double, jeu offensif avec variété de coups ; intercepte les retours faciles. Conclut le point au smash sur balles faciles.',
    serve: 'Varie la vitesse et la direction du premier service. Utilise des effets variés.',
  },
  {
    level: '4,5',
    kind: 'detailed',
    ground:
      'Maîtrise plusieurs effets. Développe soit un coup dominant, soit une grande régularité. A de la difficulté dans deux des trois cas suivants : balle rapide, balle éloignée ou balle en angle, face à un adversaire de niveau égal.',
    ret: 'Retourne les premiers services régulièrement ; les tentatives de retour offensif n’aboutissent qu’à moins de 30 %. En double, retour plus fort mais réussi à moins de 50 %.',
    net: 'Pratique le service-volée. Volées d’approche profondes ; irrégulier quand la balle reçue est puissante ou en angle. Au filet, peut conclure en angle, en amorti ou en frappe.',
    serve:
      'Premier service puissant ou à effets. Deuxième service souvent proche et profond. Peu de doubles fautes. En double, suit le premier service au filet, avec quelques erreurs encore.',
  },
  {
    level: '5,0',
    kind: 'detailed',
    ground:
      'Réussit des échanges de 10 coups en double avec confiance. Conclut une balle courte sur coup dominant. Réussit 50 % de ses contre-attaques même sur balles difficiles : rapides, éloignées, ou face à un adversaire de niveau égal.',
    ret: 'Lors de la réception de premiers services sans coup dominant, réussit son retour de qualité une fois sur deux. En double, dirige sciemment la balle vers la faiblesse adverse.',
    net: 'Excellent au filet en simple comme en double. Attaque très bien en profondeur ou en amorti. Smash efficace, peu importe la position sur le terrain.',
    serve:
      'Premier service efficace en précision, en puissance et en effets. Deuxième service de qualité limitant les retours offensifs adverses. En double, l’enchaînement service-volée est efficace.',
  },
  {
    level: '5,5',
    kind: 'summary',
    summary:
      'A développé un style de jeu identifiable : attaquant de fond de terrain, joueur polyvalent, joueur service-volée, ou contre-attaquant. Excellente anticipation (lecture du service adverse, du positionnement) et tactique (adaptation aux schémas de match). Pas de faiblesse majeure. Réussit ses contre-attaques en profondeur face à un adversaire de niveau égal. Admissible aux tournois provinciaux classe ouverte. Exploite les faiblesses adverses grâce à la variété des coups : amortis, lobs, angles, balles lentes.',
  },
  {
    level: '6,0–7,0',
    kind: 'summary',
    summary:
      'L’auto-évaluation ne s’applique plus — les classements officiels prennent le relais. Niveau 6,0 : entraînement intensif et carrière compétitive de niveau junior, universitaire ou post-universitaire. Niveau 6,5 : solide expérience des tournois internationaux ouverts (Futures, Challengers). Niveau 7,0 : professionnel du circuit international.',
  },
];

type NtrpTableLabels = {
  level: string;
  ground: string;
  ret: string;
  net: string;
  serve: string;
};

const LABELS_EN: NtrpTableLabels = {
  level: 'Level',
  ground: 'Groundstrokes',
  ret: 'Return of Serve',
  net: 'Net Play',
  serve: 'Serve',
};

const LABELS_FR: NtrpTableLabels = {
  level: 'Niveau',
  ground: 'Coups de fond',
  ret: 'Retour de service',
  net: 'Jeu de filet',
  serve: 'Service',
};

function NtrpTable({ rows, labels }: { rows: ReadonlyArray<NtrpRow>; labels: NtrpTableLabels }) {
  return (
    <div className="overflow-x-auto my-8 -mx-4 px-4">
      <table className="w-full min-w-[820px] text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-3 font-semibold align-bottom w-20">{labels.level}</th>
            <th className="text-left py-3 px-3 font-semibold align-bottom">{labels.ground}</th>
            <th className="text-left py-3 px-3 font-semibold align-bottom">{labels.ret}</th>
            <th className="text-left py-3 px-3 font-semibold align-bottom">{labels.net}</th>
            <th className="text-left py-3 px-3 font-semibold align-bottom">{labels.serve}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.level} className="border-b border-border/50 align-top">
              <td className="py-3 px-3 font-mono font-semibold whitespace-nowrap">{row.level}</td>
              {row.kind === 'summary' ? (
                <td colSpan={4} className="py-3 px-3 text-muted-foreground">
                  {row.summary}
                </td>
              ) : (
                <>
                  <td className="py-3 px-3 text-muted-foreground">{row.ground}</td>
                  <td className="py-3 px-3 text-muted-foreground">{row.ret}</td>
                  <td className="py-3 px-3 text-muted-foreground">{row.net}</td>
                  <td className="py-3 px-3 text-muted-foreground">{row.serve}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableEN() {
  return <NtrpTable rows={NTRP_ROWS_EN} labels={LABELS_EN} />;
}

function TableFR() {
  return <NtrpTable rows={NTRP_ROWS_FR} labels={LABELS_FR} />;
}

export const ntrpRatingExplained: Guide = {
  meta: {
    slug: 'ntrp-rating-explained',
    publishedAt: '2026-05-22',
    sports: ['tennis'],
    image: {
      src: '/guides/ntrp-rating-explained.jpg',
      width: 1600,
      height: 1067,
      credit: {
        url: 'https://unsplash.com/photos/a-close-up-of-a-tennis-ball-on-a-court-yOgEn5ruLjU',
      },
    },
  },
  content: {
    'en-US': {
      title: 'NTRP Rating System Explained: How to Know Your Tennis Level',
      description:
        'The NTRP rates tennis players from 1.0 (beginner) to 7.0 (touring pro). Learn how each level plays, how to self-rate honestly, and how NTRP compares to DUPR and UTR.',
      ogTitle: 'NTRP Rating System Explained — How to Know Your Tennis Level',
      ogDescription:
        'A clear, no-fluff breakdown of every NTRP level from 1.0 to 7.0, plus how to self-rate and how NTRP compares to DUPR and UTR.',
      heading: 'NTRP Rating System Explained: How to Know Your Tennis Level',
      leadAnswer:
        'The NTRP (National Tennis Rating Program) rates players from 1.0 (absolute beginner) to 7.0 (world-class pro) in half-point increments. Your rating reflects consistency, shot selection, and tactical awareness — not how hard you hit. Most recreational players land between 2.5 and 4.5.',
      imageAlt: 'Tennis ball at rest on a clay court near the baseline.',
      body: (
        <>
          <h2>The NTRP Scale, Shot by Shot</h2>
          <p>
            The NTRP was developed by the USTA in 1979 and is the most widely used self-rating
            system in North American tennis. Levels move in half-point increments (1.0, 1.5, 2.0…).
            Half-point gaps matter — a 3.5 and a 4.0 play noticeably different tennis.
          </p>
          <p>
            Strokes rarely develop at the same speed. The table below breaks each level down by shot
            type — groundstrokes, return, net play, and serve — so you can self-rate against the
            part of your game that&apos;s actually holding you up. If your strokes vary by category,
            average them honestly, or take the lower one if it shows up in matches.
          </p>
          <TableEN />

          <h2>How to Self-Rate Honestly</h2>
          <p>
            Most players over-rate themselves by half a point. Use these checks to land closer to
            the truth:
          </p>
          <ul>
            <li>
              <strong>Can you rally?</strong> If you can&apos;t sustain 5+ shots in a cooperative
              rally at medium pace, you&apos;re below 3.0.
            </li>
            <li>
              <strong>Do you have a reliable second serve?</strong> A second serve that lands
              consistently in the box with some spin is a 3.5+ marker.
            </li>
            <li>
              <strong>Can you change direction and depth on demand?</strong> Hitting cross-court
              when you choose to and down-the-line when you choose to, with depth control, is a 4.0+
              skill.
            </li>
            <li>
              <strong>Do you have a tactical plan in matches?</strong> Adjusting style mid-match
              based on what&apos;s working is a 4.5+ marker.
            </li>
          </ul>
          <p>
            The honest test: play three sets against someone whose rating you trust. If you win
            comfortably, you&apos;re likely at their level or above. If it&apos;s close, you&apos;re
            a half-point below them or matched.
          </p>

          <h2>Coming From Another Federation? Convert Your Rating to NTRP</h2>
          <p>
            If you played outside North America, pick your country below to map your home rating to
            an NTRP starting point. The mappings are derived from the official{' '}
            <a href="https://www.universaltennis.com/" target="_blank" rel="noopener noreferrer">
              UTR Conversion Chart
            </a>{' '}
            (Universal Tennis), which Universal Tennis uses internally to onboard players from
            foreign federations.
          </p>
          <RatingConversionSelector locale="en-US" defaultCode="FR" />
          <p>A few caveats worth keeping in mind:</p>
          <ul>
            <li>
              <strong>It&apos;s approximate.</strong> Most European federations award rating points
              based on tournament wins against higher-ranked opponents — a results-driven system.
              NTRP describes shot consistency and tactical awareness. A French 15/3 and a 4.0 NTRP
              recreational player will play comparable tennis on average, but individual matchups
              can swing.
            </li>
            <li>
              <strong>Recent activity matters.</strong> Most federations recalculate ratings yearly
              or seasonally, so a published rating can lag your actual level by 6–12 months. If
              you&apos;ve been off the court for a year, drop yourself a half-point below the
              conversion.
            </li>
            <li>
              <strong>Singles vs doubles.</strong> The chart assumes singles play. If most of your
              tennis abroad was doubles, your singles-NTRP is usually a half-point lower than the
              conversion suggests.
            </li>
          </ul>
          <p>
            Once you have a starting NTRP, refine it the same way everyone else does — by playing a
            few matches against opponents whose rating you trust.
          </p>

          <h2>NTRP vs DUPR vs UTR — Which Should You Use?</h2>
          <p>
            Three rating systems dominate North American recreational and competitive tennis. They
            overlap but aren&apos;t interchangeable.
          </p>
          <ul>
            <li>
              <strong>NTRP (1.0–7.0):</strong> Descriptive, self-rated, used by USTA leagues. Best
              for casual sorting and league play.
            </li>
            <li>
              <strong>UTR (1.0–16.5):</strong> Calculated from match results. Decimal precision,
              used by college coaches and tournament players.
            </li>
            <li>
              <strong>DUPR (2.0–8.0):</strong> Algorithmic, used heavily in pickleball but expanding
              to tennis. Updates after every reported match.
            </li>
          </ul>
          <p>
            For finding partners on Rallia, NTRP is usually enough — most players already know their
            rough level. If you&apos;re entering tournaments, look up your UTR.
          </p>

          <h2>How to Get an Official NTRP Rating</h2>
          <p>
            Self-rated NTRP works for most casual matchmaking. For USTA league play, you can either
            self-rate or request a computer rating after playing enough matches in the system.
            Computer ratings are recalculated yearly based on match results, so they tend to be more
            accurate than self-ratings.
          </p>
          <p>
            In Rallia, you self-rate when you create your profile and refine over time through
            verified play. Players who consistently win against opponents at their level get nudged
            up; players who lose consistently get nudged down. This keeps games competitive without
            the friction of formal rating tournaments.
          </p>

          <h2>Common Misconceptions</h2>
          <h3>&quot;I hit hard, so I&apos;m a 4.0.&quot;</h3>
          <p>
            Power without placement is a 3.0 trait. A 4.0 player chooses their shots — pace is a
            tool, not the point.
          </p>
          <h3>&quot;I&apos;ve played for 10 years, so I must be 4.5+.&quot;</h3>
          <p>
            Years played don&apos;t determine level — match-playing does. A 3.5 who plays twice a
            week is usually better than a 4.0 who plays once a month.
          </p>
          <h3>&quot;NTRP and UTR are the same thing in different units.&quot;</h3>
          <p>
            They&apos;re not. A 4.0 NTRP roughly maps to UTR 4–6, but the spread is wide because
            they measure different things. Use the system that matches the context.
          </p>

          <h2>Find Players at Your Level on Rallia</h2>
          <p>
            Once you know your NTRP rating, finding the right opponent matters more than finding any
            opponent. Mismatched level is the #1 reason recreational players quit playing. Rallia
            helps you find tennis players at your level and see each one&apos;s reliability score
            from past games, so the matches you book are more likely to be the competitive games you
            wanted.
          </p>
        </>
      ),
    },
    'fr-CA': {
      title: 'Le système de classement NTRP expliqué : comment connaître votre niveau de tennis',
      description:
        'Le NTRP classe les joueurs de tennis de 1,0 (débutant) à 7,0 (pro du circuit). Apprenez comment chaque niveau joue, comment vous auto-évaluer honnêtement, et comment le NTRP se compare au DUPR et au UTR.',
      ogTitle: 'Système de classement NTRP expliqué — Connaître votre niveau de tennis',
      ogDescription:
        'Une analyse claire et sans détour de chaque niveau NTRP de 1,0 à 7,0, plus comment vous auto-évaluer et la comparaison avec DUPR et UTR.',
      heading: 'Le système de classement NTRP expliqué : comment connaître votre niveau de tennis',
      leadAnswer:
        'Le NTRP (National Tennis Rating Program) classe les joueurs de 1,0 (débutant absolu) à 7,0 (pro de classe mondiale) par incréments d’un demi-point. Votre classement reflète la régularité, le choix des coups et la conscience tactique — pas la puissance de frappe. La plupart des joueurs récréatifs se situent entre 2,5 et 4,5.',
      imageAlt:
        'Balle de tennis au repos sur un terrain de terre battue, près de la ligne de fond.',
      body: (
        <>
          <h2>L&apos;échelle NTRP, coup par coup</h2>
          <p>
            Le NTRP a été développé par la USTA en 1979 et reste le système d&apos;auto-évaluation
            le plus utilisé dans le tennis nord-américain. Les niveaux progressent par demi-points
            (1,0, 1,5, 2,0…). L&apos;écart d&apos;un demi-point compte vraiment — un 3,5 et un 4,0
            jouent un tennis sensiblement différent.
          </p>
          <p>
            Les coups se développent rarement à la même vitesse. Le tableau ci-dessous décline
            chaque niveau par type de coup — coups de fond, retour de service, jeu de filet et
            service — pour que vous puissiez vous évaluer sur la partie de votre jeu qui vous freine
            vraiment. Si vos coups varient d&apos;une catégorie à l&apos;autre, faites la moyenne
            honnêtement, ou retenez le plus faible s&apos;il ressort en match.
          </p>
          <TableFR />

          <h2>Comment s&apos;auto-évaluer honnêtement</h2>
          <p>
            La plupart des joueurs se surévaluent d&apos;un demi-point. Utilisez ces repères pour
            rester près de la vérité&nbsp;:
          </p>
          <ul>
            <li>
              <strong>Pouvez-vous échanger ?</strong> Si vous n&apos;arrivez pas à enchaîner 5
              frappes ou plus dans un échange coopératif à vitesse modérée, vous êtes sous le 3,0.
            </li>
            <li>
              <strong>Avez-vous une deuxième balle de service fiable ?</strong> Une deuxième balle
              qui retombe régulièrement dans le carré avec un peu d&apos;effet est un marqueur de
              3,5 et plus.
            </li>
            <li>
              <strong>Pouvez-vous changer la direction et la profondeur sur demande ?</strong>{' '}
              Frapper en croisé ou le long de la ligne par choix, avec contrôle de la profondeur,
              est une compétence 4,0 et plus.
            </li>
            <li>
              <strong>Avez-vous un plan tactique en match ?</strong> Ajuster votre style en cours de
              match selon ce qui fonctionne est un marqueur de 4,5 et plus.
            </li>
          </ul>
          <p>
            Le test honnête&nbsp;: jouez trois manches contre quelqu&apos;un dont vous croyez le
            classement. Si vous gagnez confortablement, vous êtes probablement à son niveau ou
            au-dessus. Si c&apos;est serré, vous êtes un demi-point sous lui ou à égalité.
          </p>

          <h2>
            Vous arrivez d&apos;une autre fédération&nbsp;? Convertissez votre classement en NTRP
          </h2>
          <p>
            Si vous avez joué à l&apos;extérieur de l&apos;Amérique du Nord, choisissez votre pays
            ci-dessous pour faire correspondre votre classement national à un NTRP de départ. Les
            correspondances sont tirées du{' '}
            <a href="https://www.universaltennis.com/" target="_blank" rel="noopener noreferrer">
              UTR Conversion Chart
            </a>{' '}
            officiel (Universal Tennis), utilisé en interne par Universal Tennis pour intégrer les
            joueurs provenant des fédérations étrangères.
          </p>
          <RatingConversionSelector locale="fr-CA" defaultCode="FR" />
          <p>Quelques nuances à garder en tête&nbsp;:</p>
          <ul>
            <li>
              <strong>C&apos;est approximatif.</strong> La plupart des fédérations européennes
              attribuent des points selon les victoires en tournoi contre des joueurs mieux classés
              — un système axé sur les résultats. Le NTRP décrit la régularité des coups et la
              conscience tactique. Un joueur français classé 15/3 et un joueur récréatif NTRP 4,0
              jouent un tennis comparable en moyenne, mais les confrontations individuelles peuvent
              varier.
            </li>
            <li>
              <strong>L&apos;activité récente compte.</strong> La plupart des fédérations
              recalculent les classements une fois par année ou par saison, donc un classement
              publié peut être en retard de 6 à 12 mois sur le vrai niveau. Si vous n&apos;avez pas
              joué depuis un an, soustrayez un demi-point au NTRP de la conversion.
            </li>
            <li>
              <strong>Simple vs double.</strong> Le tableau suppose du jeu en simple. Si votre
              tennis à l&apos;étranger était surtout en double, votre NTRP en simple est
              généralement un demi-point sous ce que la conversion suggère.
            </li>
          </ul>
          <p>
            Une fois votre NTRP de départ établi, ajustez-le comme tout le monde — en jouant
            quelques matchs contre des adversaires dont vous croyez le classement.
          </p>

          <h2>NTRP, DUPR ou UTR — lequel utiliser&nbsp;?</h2>
          <p>
            Trois systèmes de classement dominent le tennis récréatif et compétitif en Amérique du
            Nord. Ils se recoupent mais ne sont pas interchangeables.
          </p>
          <ul>
            <li>
              <strong>NTRP (1,0–7,0)&nbsp;:</strong> descriptif, auto-évalué, utilisé par les ligues
              USTA. Idéal pour le jumelage récréatif et la ligue.
            </li>
            <li>
              <strong>UTR (1,0–16,5)&nbsp;:</strong> calculé à partir des résultats de matchs.
              Précision décimale, utilisé par les entraîneurs universitaires et les joueurs de
              tournoi.
            </li>
            <li>
              <strong>DUPR (2,0–8,0)&nbsp;:</strong> algorithmique, surtout utilisé en pickleball
              mais s&apos;étend au tennis. Mise à jour après chaque match rapporté.
            </li>
          </ul>
          <p>
            Pour trouver des partenaires sur Rallia, le NTRP suffit dans la plupart des cas — la
            plupart des joueurs connaissent déjà leur niveau approximatif. Si vous participez à des
            tournois, consultez votre UTR.
          </p>

          <h2>Comment obtenir un classement NTRP officiel</h2>
          <p>
            Le NTRP auto-évalué fonctionne pour la majorité du jumelage récréatif. Pour la ligue
            USTA, vous pouvez vous auto-évaluer ou demander un classement calculé par ordinateur
            après avoir joué suffisamment de matchs dans le système. Les classements calculés sont
            recalculés annuellement à partir des résultats, donc plus précis que
            l&apos;auto-évaluation.
          </p>
          <p>
            Sur Rallia, vous vous auto-évaluez à la création de votre profil et votre niveau
            s&apos;affine au fil des matchs vérifiés. Les joueurs qui gagnent régulièrement contre
            des adversaires de leur niveau montent&nbsp;; ceux qui perdent régulièrement descendent.
            Les parties restent compétitives sans la lourdeur des tournois de classement formels.
          </p>

          <h2>Idées reçues fréquentes</h2>
          <h3>«&nbsp;Je frappe fort, donc je suis 4,0.&nbsp;»</h3>
          <p>
            La puissance sans placement est un trait de 3,0. Un joueur de 4,0 choisit ses coups — la
            vitesse est un outil, pas une fin.
          </p>
          <h3>«&nbsp;Je joue depuis 10 ans, je dois être 4,5+.&nbsp;»</h3>
          <p>
            Les années jouées ne déterminent pas le niveau — le volume de matchs, oui. Un joueur de
            3,5 qui joue deux fois par semaine est généralement meilleur qu&apos;un 4,0 qui joue une
            fois par mois.
          </p>
          <h3>«&nbsp;NTRP et UTR mesurent la même chose dans des unités différentes.&nbsp;»</h3>
          <p>
            Faux. Un NTRP de 4,0 correspond grossièrement à un UTR de 4 à 6, mais l&apos;écart est
            large parce qu&apos;ils mesurent des choses différentes. Utilisez le système adapté au
            contexte.
          </p>

          <h2>Trouvez des joueurs à votre niveau sur Rallia</h2>
          <p>
            Une fois votre NTRP connu, trouver le bon adversaire compte plus que trouver
            n&apos;importe quel adversaire. Le mauvais appariement de niveau est la première raison
            pour laquelle les joueurs récréatifs arrêtent. Rallia vous aide à trouver des joueurs de
            tennis de votre niveau et à consulter le score de fiabilité de chacun d&apos;eux, pour
            que les parties que vous réservez aient plus de chances d&apos;être les vraies parties
            compétitives que vous cherchiez.
          </p>
        </>
      ),
    },
  },
};
