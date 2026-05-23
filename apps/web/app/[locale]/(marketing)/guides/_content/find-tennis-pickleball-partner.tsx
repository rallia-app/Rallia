import type { Guide } from './types';

const COMPARISON_EN: Array<[string, string, string, string]> = [
  ['Court bulletin boards', 'Free, local, casual', 'Slow, hit-or-miss', 'Anyone with a court'],
  [
    'Local club leagues',
    'Reliable schedule, vetted level',
    'Costs $$, often full',
    'People who commit',
  ],
  [
    'Facebook groups & Subreddits',
    'Free, large pool',
    'Flaky, noisy, level-mixed',
    'Anyone with internet',
  ],
  [
    'Matchmaking apps',
    'Level-matched, scheduling built in',
    'Network needs to be active locally',
    'Anyone with a smartphone',
  ],
];

const COMPARISON_FR: Array<[string, string, string, string]> = [
  [
    'Babillards de terrains',
    'Gratuit, local, décontracté',
    'Lent, aléatoire',
    'Toute personne avec accès au terrain',
  ],
  [
    'Ligues de club locales',
    'Horaire fiable, niveau filtré',
    'Coût, souvent complet',
    'Joueurs engagés',
  ],
  [
    'Groupes Facebook / Reddit',
    'Gratuit, grand bassin',
    'Désistements, bruyant, niveaux mêlés',
    'Toute personne sur internet',
  ],
  [
    'Applications de jumelage',
    'Niveau apparié, planification intégrée',
    'Réseau doit être actif localement',
    'Toute personne avec un téléphone',
  ],
];

function TableEN() {
  return (
    <div className="overflow-x-auto my-8">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 font-semibold">Channel</th>
            <th className="text-left py-3 px-4 font-semibold">Strength</th>
            <th className="text-left py-3 px-4 font-semibold">Weakness</th>
            <th className="text-left py-3 px-4 font-semibold">Best for</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_EN.map(([ch, s, w, b]) => (
            <tr key={ch} className="border-b border-border/50">
              <td className="py-3 px-4 font-semibold">{ch}</td>
              <td className="py-3 px-4 text-muted-foreground">{s}</td>
              <td className="py-3 px-4 text-muted-foreground">{w}</td>
              <td className="py-3 px-4 text-muted-foreground">{b}</td>
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
            <th className="text-left py-3 px-4 font-semibold">Canal</th>
            <th className="text-left py-3 px-4 font-semibold">Force</th>
            <th className="text-left py-3 px-4 font-semibold">Faiblesse</th>
            <th className="text-left py-3 px-4 font-semibold">Idéal pour</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_FR.map(([ch, s, w, b]) => (
            <tr key={ch} className="border-b border-border/50">
              <td className="py-3 px-4 font-semibold">{ch}</td>
              <td className="py-3 px-4 text-muted-foreground">{s}</td>
              <td className="py-3 px-4 text-muted-foreground">{w}</td>
              <td className="py-3 px-4 text-muted-foreground">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const findTennisPickleballPartner: Guide = {
  meta: {
    slug: 'find-tennis-pickleball-partner',
    publishedAt: '2026-05-22',
    sports: ['tennis', 'pickleball'],
    image: {
      src: '/guides/find-tennis-pickleball-partner.jpg',
      width: 1600,
      height: 1067,
      credit: {
        name: 'Oana Buzatu',
        url: 'https://unsplash.com/photos/two-men-playing-tennis-on-a-tennis-court-zkA8IRNu2qk',
      },
    },
  },
  content: {
    'en-US': {
      title: 'How to Find a Tennis or Pickleball Partner (Without the Group Chat Chaos)',
      description:
        'Four real ways to find a tennis or pickleball partner: bulletin boards, club leagues, social media, and matchmaking apps. Tradeoffs, red flags, and how to build a regular rotation.',
      ogTitle: 'How to Find a Tennis or Pickleball Partner — A Practical Guide',
      ogDescription:
        'The four channels that actually work, their tradeoffs, and the red flags that signal a no-show before you book the court.',
      heading: 'How to Find a Tennis or Pickleball Partner (Without the Group Chat Chaos)',
      leadAnswer:
        'Finding a regular tennis or pickleball partner usually comes down to four channels: court bulletin boards, local club leagues, social media groups, and matchmaking apps like Rallia. Each has trade-offs. Most committed players use a mix of two or three. Pick by what you need most: free and local, vetted level, biggest pool, or zero scheduling friction.',
      imageAlt: 'Two tennis players on a court mid-match.',
      body: (
        <>
          <h2>The Four Ways to Find a Partner</h2>
          <p>
            Almost every long-term recreational player gets their games from one of four sources.
            None of them are perfect, but knowing which one matches your situation saves months of
            stop-and-start play.
          </p>
          <TableEN />

          <h2>1. Court Bulletin Boards & Drop-In Sessions</h2>
          <p>
            Most public tennis and pickleball courts have a physical or digital bulletin board where
            players post their level and availability. Drop-in sessions at municipal centers are the
            same idea — show up, get matched at the front desk, play.
          </p>
          <p>
            <strong>When this works:</strong> you live near an active court, you have a flexible
            schedule, and you’re looking for casual play more than a regular partner.
          </p>
          <p>
            <strong>When it doesn’t:</strong> if your local courts are quiet, you’ll spend more time
            at the board than on the court. Drop-in level matching is also weakly enforced — you’ll
            often end up paired with someone half a level off.
          </p>

          <h2>2. Local Club Leagues</h2>
          <p>
            Clubs, racquet clubs, and rec centers run organized leagues at fixed levels — usually 6
            to 10 weeks long, with the club doing the matchmaking and scheduling.
          </p>
          <p>
            <strong>Strengths:</strong> the level filtering actually works. People who pay to enter
            a league are committed to showing up. You build a small circle of regulars in your level
            over a season.
          </p>
          <p>
            <strong>Weaknesses:</strong> cost. League fees run $80–$300+ per season. Many leagues
            are also full by the time you ask — sign-ups typically open 4–6 weeks before the season
            starts and the good ones close quickly.
          </p>
          <p>
            <strong>Pro tip:</strong> if you’re new to a club, ask the league coordinator to add you
            to the waitlist for the level <em>above and below</em> yours. Drop-ins happen all season
            and you’ll get called.
          </p>

          <h2>3. Facebook Groups, Subreddits, and Local Forums</h2>
          <p>
            Most cities have at least one active “[City] Tennis” or “[City] Pickleball” Facebook
            group with anywhere from a few hundred to tens of thousands of members. Subreddits like
            r/tennis and r/pickleball are quieter but have local-meetup threads.
          </p>
          <p>
            <strong>Strengths:</strong> the pool is huge and free. If you live in a city, you’ll
            find <em>someone</em> at your level.
          </p>
          <p>
            <strong>Weaknesses:</strong> coordinating through comments and DMs is brutal. Posts get
            buried, people flake, and there’s no built-in level verification — everyone claims to be
            a 3.5. Expect to send 5–10 messages to lock down one actual game.
          </p>
          <p>
            <strong>How to make it work:</strong> post a specific time, court, and level. “Looking
            for a 3.5 hit Thursday 6pm at Westmount, 90 min” gets ten replies. “Anyone want to
            play?” gets one. Be specific and you save yourself the back-and-forth.
          </p>

          <h2>4. Matchmaking Apps</h2>
          <p>
            Apps like Rallia exist to compress the four-step coordination problem (find a player,
            agree on a court, agree on a time, confirm everyone’s coming) into a few taps. You set
            your level and availability, the app shows you open games or matched players nearby, you
            join with one tap, and the schedule is locked in.
          </p>
          <p>
            <strong>Strengths:</strong> level matching is built in, scheduling is automated, and
            reputation systems weed out the chronic no-shows. You don’t maintain any group chats.
          </p>
          <p>
            <strong>Weaknesses:</strong> depends on whether the app has critical mass in your city.
            A great app with 12 players in your area is worse than a mediocre app with 1,000. Check
            local activity before committing.
          </p>

          <h2>What to Look For in a Good Match</h2>
          <p>Beyond rating, what makes someone a partner you actually want to play with again?</p>
          <ul>
            <li>
              <strong>They show up on time.</strong> This is the #1 differentiator between fun and
              frustrating tennis. A 4.5 who’s 30 minutes late is worse than a 3.0 who’s punctual.
            </li>
            <li>
              <strong>They want similar things from the game.</strong> Some people want a workout,
              some want a competitive grind, some want a hit-and-chat. Match the vibe.
            </li>
            <li>
              <strong>They call lines honestly</strong>, including against themselves. One match
              with a hook and you’ll dread every future game.
            </li>
            <li>
              <strong>They confirm the day-of.</strong> Anyone who doesn’t reconfirm the morning of
              the game is statistically more likely to flake.
            </li>
          </ul>

          <h2>Red Flags Before You Book the Court</h2>
          <ul>
            <li>
              <strong>Vague level claims.</strong> “I’ve played for a long time” is not a level. Ask
              for an NTRP, UTR, or DUPR number, or ask what level league they play.
            </li>
            <li>
              <strong>
                They want to start with doubles before you’ve played singles together.
              </strong>{' '}
              Doubles partnerships are harder to back out of mid-rally. A first hit should be open
              play, not a competitive doubles match.
            </li>
            <li>
              <strong>They go quiet for days, then suddenly “see you tonight!”</strong> Pattern of
              flaky messaging is the strongest predictor of no-show.
            </li>
            <li>
              <strong>They suggest a court you’ve never heard of, far from where they live.</strong>
              Either weirdly inconvenient or a sign of low intent. Pick a neutral, easy court for
              the first game.
            </li>
          </ul>

          <h2>Building From One Game to a Regular Rotation</h2>
          <p>
            The endgame isn’t finding one good partner — it’s having three or four reliable ones so
            you can always find a game. The fastest path:
          </p>
          <ol>
            <li>
              <strong>Lock in one regular slot</strong> (same day, same time, same court) with the
              first reliable partner you find. Even once a week is enough.
            </li>
            <li>
              <strong>When that game falls through, swap-don’t-cancel.</strong> Have a backup
              partner you can text. The slot is sacred, the partner is interchangeable.
            </li>
            <li>
              <strong>After 5–10 sessions, branch out.</strong> Ask your regular for someone of
              similar level. Tennis players are usually generous with intros — it’s a small world.
            </li>
            <li>
              <strong>Stack a doubles rotation.</strong> Four players who agree to be each other’s
              go-to fourth means a doubles game is one text away, anytime.
            </li>
          </ol>

          <h2>The Rallia Way</h2>
          <p>
            Rallia is designed for the regular-rotation problem. Set your level, your home courts,
            and your usual times — and you’ll see matched players posting open games near you. Join
            with a tap. Every player has a reliability score from past games, so you can see who
            tends to show up before you book. Over a few games, you can start building a rotation
            without coordinating a group chat.
          </p>
        </>
      ),
    },
    'fr-CA': {
      title:
        'Comment trouver un partenaire de tennis ou de pickleball (sans le chaos des groupes de discussion)',
      description:
        'Quatre vraies façons de trouver un partenaire de tennis ou de pickleball : babillards de terrains, ligues de club, médias sociaux et applications de jumelage. Compromis, signaux d’alarme et comment bâtir une rotation régulière.',
      ogTitle: 'Comment trouver un partenaire de tennis ou de pickleball — guide pratique',
      ogDescription:
        'Les quatre canaux qui fonctionnent vraiment, leurs compromis et les signaux d’alarme qui annoncent un désistement.',
      heading:
        'Comment trouver un partenaire de tennis ou de pickleball (sans le chaos des groupes de discussion)',
      leadAnswer:
        'Trouver un partenaire régulier de tennis ou de pickleball passe presque toujours par quatre canaux&nbsp;: les babillards de terrains, les ligues de club locales, les groupes sur les médias sociaux et les applications de jumelage comme Rallia. Chacun a ses compromis. La plupart des joueurs engagés utilisent deux ou trois canaux en parallèle. Choisissez selon ce qui compte le plus pour vous&nbsp;: gratuit et local, niveau filtré, plus grand bassin, ou zéro friction de planification.',
      imageAlt: 'Deux joueurs de tennis sur un terrain pendant un match.',
      body: (
        <>
          <h2>Les quatre façons de trouver un partenaire</h2>
          <p>
            Presque tous les joueurs récréatifs réguliers trouvent leurs parties dans l’une de ces
            quatre sources. Aucune n’est parfaite, mais savoir laquelle correspond à votre situation
            vous épargne des mois de jeu intermittent.
          </p>
          <TableFR />

          <h2>1. Babillards de terrains et séances libres</h2>
          <p>
            La plupart des terrains publics de tennis et de pickleball ont un babillard physique ou
            numérique où les joueurs affichent leur niveau et leurs disponibilités. Les séances
            libres dans les centres municipaux fonctionnent de la même façon — vous arrivez, on vous
            jumelle à l’accueil, vous jouez.
          </p>
          <p>
            <strong>Quand ça marche&nbsp;:</strong> vous habitez près d’un terrain actif, votre
            horaire est flexible et vous cherchez du jeu décontracté plus qu’un partenaire régulier.
          </p>
          <p>
            <strong>Quand ça ne marche pas&nbsp;:</strong> si vos terrains locaux sont tranquilles,
            vous passerez plus de temps au babillard que sur le terrain. Le filtrage de niveau en
            séance libre est aussi faiblement appliqué — vous risquez de jouer avec quelqu’un d’un
            demi-niveau en dehors du vôtre.
          </p>

          <h2>2. Ligues de club locales</h2>
          <p>
            Les clubs, clubs de raquette et centres récréatifs organisent des ligues à des niveaux
            fixes — généralement de 6 à 10&nbsp;semaines, le club s’occupant du jumelage et de
            l’horaire.
          </p>
          <p>
            <strong>Forces&nbsp;:</strong> le filtrage de niveau fonctionne vraiment. Les gens qui
            paient pour entrer dans une ligue se présentent. Vous bâtissez un petit cercle de
            réguliers à votre niveau sur une saison.
          </p>
          <p>
            <strong>Faiblesses&nbsp;:</strong> le coût. Les frais de ligue vont de 100&nbsp;$ à
            400&nbsp;$+ par saison. Beaucoup de ligues sont complètes au moment où vous demandez —
            les inscriptions ouvrent généralement 4 à 6&nbsp;semaines avant le début, et les
            meilleures ferment vite.
          </p>
          <p>
            <strong>Truc&nbsp;:</strong> si vous êtes nouveau dans un club, demandez au
            coordonnateur de ligue d’être sur la liste d’attente pour le niveau{' '}
            <em>au-dessus et en dessous</em> du vôtre. Les remplacements arrivent toute la saison —
            on vous appellera.
          </p>

          <h2>3. Groupes Facebook, Reddit et forums locaux</h2>
          <p>
            La plupart des villes ont au moins un groupe Facebook actif «&nbsp;Tennis [ville]&nbsp;»
            ou «&nbsp;Pickleball [ville]&nbsp;» allant de quelques centaines à des dizaines de
            milliers de membres. Les sous-forums r/tennis et r/pickleball sur Reddit sont plus
            tranquilles mais ont des fils de rencontres locales.
          </p>
          <p>
            <strong>Forces&nbsp;:</strong> le bassin est énorme et gratuit. Si vous habitez en
            ville, vous trouverez <em>quelqu’un</em> à votre niveau.
          </p>
          <p>
            <strong>Faiblesses&nbsp;:</strong> la coordination par commentaires et messages privés
            est pénible. Les publications se font enterrer, les gens se désistent, et il n’y a
            aucune vérification de niveau — tout le monde se déclare 3,5. Prévoyez 5 à
            10&nbsp;messages pour bloquer une seule vraie partie.
          </p>
          <p>
            <strong>Comment maximiser&nbsp;:</strong> publiez une heure, un terrain et un niveau
            précis. «&nbsp;Cherche échange 3,5 jeudi 18h à Westmount, 90&nbsp;min&nbsp;» reçoit dix
            réponses. «&nbsp;Quelqu’un veut jouer&nbsp;?&nbsp;» en reçoit une. Soyez précis et vous
            sautez l’aller-retour.
          </p>

          <h2>4. Applications de jumelage</h2>
          <p>
            Des applications comme Rallia existent pour compresser le problème en quatre étapes
            (trouver un joueur, s’entendre sur un terrain, s’entendre sur une heure, confirmer la
            présence de tout le monde) en quelques touches. Vous inscrivez votre niveau et vos
            disponibilités, l’application vous montre des parties ouvertes ou des joueurs apparentés
            près de vous, vous joignez d’une touche, l’horaire est verrouillé.
          </p>
          <p>
            <strong>Forces&nbsp;:</strong> filtrage de niveau intégré, planification automatisée, et
            les systèmes de réputation éliminent les désistements chroniques. Vous ne maintenez
            aucun groupe de discussion.
          </p>
          <p>
            <strong>Faiblesses&nbsp;:</strong> dépend de la masse critique de l’application dans
            votre ville. Une bonne application avec 12 joueurs chez vous est pire qu’une application
            médiocre avec 1&nbsp;000. Vérifiez l’activité locale avant de vous engager.
          </p>

          <h2>Ce qui fait un bon partenaire (au-delà du niveau)</h2>
          <p>Au-delà du classement, qu’est-ce qui rend quelqu’un agréable à rejouer&nbsp;?</p>
          <ul>
            <li>
              <strong>Il arrive à l’heure.</strong> C’est le facteur n°&nbsp;1 entre un tennis
              agréable et un tennis frustrant. Un 4,5 en retard de 30&nbsp;minutes est pire qu’un
              3,0 ponctuel.
            </li>
            <li>
              <strong>Il veut la même chose de la partie.</strong> Certains cherchent un
              entraînement, d’autres une compétition serrée, d’autres un échange-discussion.
              Assortissez l’intention.
            </li>
            <li>
              <strong>Il appelle les lignes honnêtement</strong>, y compris contre lui-même. Une
              seule partie avec un tricheur et vous redouterez toutes les suivantes.
            </li>
            <li>
              <strong>Il confirme la journée même.</strong> Quelqu’un qui ne reconfirme pas le matin
              de la partie est statistiquement plus susceptible de se désister.
            </li>
          </ul>

          <h2>Signaux d’alarme avant de réserver le terrain</h2>
          <ul>
            <li>
              <strong>Affirmations de niveau floues.</strong> «&nbsp;Je joue depuis longtemps&nbsp;»
              n’est pas un niveau. Demandez un chiffre NTRP, UTR ou DUPR, ou quel niveau de ligue.
            </li>
            <li>
              <strong>
                Il veut commencer par un double avant que vous n’ayez joué en simple ensemble.
              </strong>{' '}
              Un partenariat de double est plus difficile à quitter en milieu d’échange. Un premier
              match devrait être un jeu ouvert, pas un double compétitif.
            </li>
            <li>
              <strong>
                Il devient silencieux pendant des jours, puis lance subitement «&nbsp;on se voit ce
                soir&nbsp;!&nbsp;»
              </strong>{' '}
              Un patron de messages erratique prédit fortement les désistements.
            </li>
            <li>
              <strong>Il propose un terrain inconnu, loin de chez lui.</strong> Soit bizarrement peu
              pratique, soit signe de faible intention. Choisissez un terrain neutre et accessible
              pour la première partie.
            </li>
          </ul>

          <h2>Passer d’une partie à une rotation régulière</h2>
          <p>
            L’objectif final n’est pas de trouver un bon partenaire — c’est d’en avoir trois ou
            quatre fiables pour toujours pouvoir trouver une partie. Le chemin le plus rapide&nbsp;:
          </p>
          <ol>
            <li>
              <strong>Verrouillez un créneau régulier</strong> (même jour, même heure, même terrain)
              avec le premier partenaire fiable que vous trouvez. Une fois par semaine suffit.
            </li>
            <li>
              <strong>Quand cette partie tombe, échangez — ne l’annulez pas.</strong> Ayez un
              partenaire de secours à qui écrire. Le créneau est sacré, le partenaire est
              interchangeable.
            </li>
            <li>
              <strong>Après 5 à 10&nbsp;séances, élargissez.</strong> Demandez à votre régulier de
              vous présenter quelqu’un de niveau similaire. Les joueurs de tennis sont généralement
              généreux pour les présentations — c’est un petit monde.
            </li>
            <li>
              <strong>Bâtissez une rotation de double.</strong> Quatre joueurs qui acceptent d’être
              le quatrième de service de chacun — et une partie de double est à un message de
              distance, n’importe quand.
            </li>
          </ol>

          <h2>L’approche Rallia</h2>
          <p>
            Rallia est conçu pour le problème de la rotation régulière. Inscrivez votre niveau, vos
            terrains habituels et vos horaires — et vous verrez les joueurs apparentés publier des
            parties ouvertes près de chez vous. Joignez en une touche. Chaque joueur a un score de
            fiabilité basé sur ses parties passées, pour voir qui tend à se présenter avant de
            réserver. Au fil des parties, vous pouvez bâtir une rotation sans coordonner de groupe
            de discussion.
          </p>
        </>
      ),
    },
  },
};
