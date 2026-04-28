# Permissions & Access Control

> Authoritative role × action matrix and the RLS policies that enforce it.

## Role resolution

Roles are resolved at request time per entity:

| Source                                                                                              | Result                       |
| --------------------------------------------------------------------------------------------------- | ---------------------------- |
| `tournaments.organizer_id = auth.uid()`                                                             | Tournament Organizer         |
| `tournament_co_organizers.user_id = auth.uid()`                                                     | Tournament Co-Organizer      |
| `tournament_registrations.user_id = auth.uid()` AND status IN ('registered','pending','waitlisted') | Tournament Participant       |
| `leagues.organizer_id = auth.uid()`                                                                 | League Organizer             |
| `league_members.user_id = auth.uid()` AND role = 'co_organizer' AND status = 'active'               | League Co-Organizer          |
| `league_members.user_id = auth.uid()` AND role = 'member' AND status = 'active'                     | League Member                |
| `league_members.user_id = auth.uid()` AND status = 'inactive'                                       | Former League Member         |
| (none of the above) AND `visibility = 'public'`                                                     | Spectator                    |
| (none of the above) AND `visibility = 'public'` AND `auth.uid() IS NULL`                            | Guest                        |
| (none) AND `visibility = 'community'` AND user is community member                                  | Spectator (community-scoped) |
| (none) AND `visibility = 'private'`                                                                 | No access                    |

The Rallia GOD MODE admin (system 15) overrides all checks; identified by `app_metadata.is_admin = true`.

## Tournament action matrix

Legend: ✅ allowed · ❌ denied · ⚠️ allowed with side effect · — n/a

| Action                                       | Organizer | Co-Org | Participant | Spectator | Guest |
| -------------------------------------------- | :-------: | :----: | :---------: | :-------: | :---: |
| View public tournament page                  |    ✅     |   ✅   |     ✅      |    ✅     |  ✅   |
| View private tournament page                 |    ✅     |   ✅   |     ✅      |    ❌     |  ❌   |
| View bracket                                 |    ✅     |   ✅   |     ✅      |    ✅¹    |  ✅¹  |
| View participant list                        |    ✅     |   ✅   |     ✅      |    ✅¹    |  ❌   |
| View audit log                               |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Create tournament                            |    ⚠️²    |   —    |      —      |     —     |   —   |
| Edit tournament metadata (name, description) |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Edit format (max participants, bracket type) |    ✅³    |  ✅³   |     ❌      |    ❌     |  ❌   |
| Open registration                            |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Close registration                           |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Self-register                                |    ❌⁴    |  ❌⁴   |      —      |    ⚠️⁵    |  ❌   |
| Approve pending registration                 |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Disqualify a participant                     |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Withdraw self                                |     —     |   —    |     ✅      |     —     |   —   |
| Generate bracket                             |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Manually swap players in bracket             |    ✅⁶    |  ✅⁶   |     ❌      |    ❌     |  ❌   |
| Submit own match score                       |     —     |   —    |     ✅      |     —     |   —   |
| Override any match score                     |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Validate / reject submitted score            |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Dispute opponent's submitted score           |     —     |   —    |     ✅      |     —     |   —   |
| Reset match to PENDING                       |    ✅⁷    |  ✅⁷   |     ❌      |    ❌     |  ❌   |
| Cancel tournament                            |    ✅     |   ❌   |     ❌      |    ❌     |  ❌   |
| Archive tournament                           |    ✅     |   ✅   |     ❌      |    ❌     |  ❌   |
| Delete tournament                            |    ✅⁸    |   ❌   |     ❌      |    ❌     |  ❌   |
| Add/remove co-organizer                      |    ✅     |   ❌   |     ❌      |    ❌     |  ❌   |
| Transfer organizer role                      |    ✅     |   ❌   |     ❌      |    ❌     |  ❌   |

¹ Viewing public-tournament data without auth is gated by [progressive auth principle](../principles.md#8-progressive-authentication-guest-first-access). Personal data (last names, photos) is masked for guests according to [player-visibility](../06-player-directory/player-visibility.md).

² Anyone with an authenticated, onboarded account in the matching sport universe may create.

³ Format-altering edits are blocked once `bracket_locked_at IS NOT NULL` (i.e., first match completed). See [tournaments.md](./tournaments.md#editable-fields-by-state).

⁴ Organizers and Co-Organizers may self-register only if `tournaments.organizer_id <> auth.uid()` for the registration action — they can register in tournaments they don't run.

⁵ Spectator can self-register on PUBLIC `open` registration mode after authenticating.

⁶ Manual swap, move, insert, and remove require both involved matches to be in status `pending`. Once `tournaments.bracket_locked_at IS NOT NULL` (set when the first non-BYE match terminates), all structural edits return `BRACKET_LOCKED`. Score corrections, organizer overrides, and `tournament_reset_match` remain available — see [tournament-bracket.md](./tournament-bracket.md#after-first-match-plays).

⁷ Resetting an `in_progress`/`completed` match invalidates downstream advancements and emits a `match_reset` reputation-neutral audit event. The bracket recomputes from the reset point.

⁸ Hard delete is allowed only while `status = 'draft'` and no participants are registered. Otherwise the tournament must be cancelled then archived.

## League action matrix

| Action                                   | Organizer | Co-Org | Member | Former | Spectator | Guest |
| ---------------------------------------- | :-------: | :----: | :----: | :----: | :-------: | :---: |
| View public league page                  |    ✅     |   ✅   |   ✅   |   ✅   |    ✅     |  ✅   |
| View private league page                 |    ✅     |   ✅   |   ✅   |   ✅   |    ❌     |  ❌   |
| View ranking                             |    ✅     |   ✅   |   ✅   |   ✅   |    ✅¹    |  ✅¹  |
| View member list                         |    ✅     |   ✅   |   ✅   |   ✅   |    ❌     |  ❌   |
| View audit log                           |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Create league                            |    ⚠️²    |   —    |   —    |   —    |     —     |   —   |
| Edit league metadata                     |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Edit `default_rules`                     |    ✅³    |  ✅³   |   ❌   |   ❌   |    ❌     |  ❌   |
| Pause / resume / close league            |    ✅     |   ❌   |   ❌   |   ❌   |    ❌     |  ❌   |
| Delete league                            |    ✅⁴    |   ❌   |   ❌   |   ❌   |    ❌     |  ❌   |
| Add/remove co-organizer                  |    ✅     |   ❌   |   ❌   |   ❌   |    ❌     |  ❌   |
| Approve member                           |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Suspend / un-suspend member              |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Kick member                              |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Self-join                                |    ❌⁵    |  ❌⁵   |   —    |  ⚠️⁶   |    ⚠️⁶    |  ❌   |
| Self-leave                               |     —     |  ✅⁷   |   ✅   |   —    |     —     |   —   |
| Create season                            |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Open / close season                      |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Edit season rules (before OPEN)          |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Create / publish session                 |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Cancel session                           |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Confirm/decline presence                 |     —     |   —    |   ✅   |   —    |     —     |   —   |
| Generate match sheet                     |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Regenerate match sheet (non-locked rows) |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Lock / unlock individual match           |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Manually swap session-match players      |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Submit own match score                   |     —     |   —    |   ✅   |   —    |     —     |   —   |
| Override any match score                 |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Validate / reject submitted score        |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Force ranking recalculation              |    ✅     |   ✅   |   ❌   |   ❌   |    ❌     |  ❌   |
| Transfer organizer role                  |    ✅     |   ❌   |   ❌   |   ❌   |    ❌     |  ❌   |

¹ Subject to `leagues.visibility` and the ranking-privacy column documented in [leagues.md](./leagues.md#ranking-privacy).

² Members with `active` status may create a league inside a community they belong to. Otherwise any onboarded user can create personal leagues.

³ Edits to `default_rules` apply to **future** seasons only; existing seasons retain their frozen `rules`.

⁴ Hard delete allowed only while status is `paused` or `closed` and no seasons exist.

⁵ Organizers and Co-Organizers cannot "join" their own league (they are members by virtue of role).

⁶ Self-join behavior depends on `leagues.join_mode`: `open` → status `active` immediately; `approval` → status `pending`; `invite_only` → blocked unless an invite row pre-exists.

⁷ Co-Organizer leaving auto-demotes them to `member` first; if no other organizer exists, leave is blocked.

## RLS policies

Each table has RLS enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`). Below are the canonical policies; the migration file installs them verbatim.

### Helper functions

```sql
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

CREATE OR REPLACE FUNCTION is_tournament_organizer(p_tournament_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.id = p_tournament_id AND t.organizer_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM tournament_co_organizers c
    WHERE c.tournament_id = p_tournament_id AND c.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION is_league_organizer(p_league_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = p_league_id AND l.organizer_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM league_members m
    WHERE m.league_id = p_league_id
      AND m.user_id = auth.uid()
      AND m.role = 'co_organizer'
      AND m.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION is_active_league_member(p_league_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.status = 'active'
  );
$$;
```

### `tournaments`

```sql
CREATE POLICY tournaments_select ON tournaments FOR SELECT USING (
  is_admin()
  OR visibility = 'public'
  OR organizer_id = auth.uid()
  OR is_tournament_organizer(id)
  OR EXISTS (SELECT 1 FROM tournament_registrations r WHERE r.tournament_id = id AND r.user_id = auth.uid())
  OR (
    visibility = 'community'
    AND community_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM community_members cm
      WHERE cm.community_id = tournaments.community_id
        AND cm.user_id = auth.uid()
        AND cm.status = 'active'
    )
  )
);

CREATE POLICY tournaments_insert ON tournaments FOR INSERT WITH CHECK (
  organizer_id = auth.uid()
);

CREATE POLICY tournaments_update ON tournaments FOR UPDATE USING (
  is_admin() OR is_tournament_organizer(id)
) WITH CHECK (
  is_admin() OR is_tournament_organizer(id)
);

CREATE POLICY tournaments_delete ON tournaments FOR DELETE USING (
  is_admin() OR organizer_id = auth.uid()
);
```

### `tournament_registrations`

```sql
CREATE POLICY treg_select ON tournament_registrations FOR SELECT USING (
  is_admin()
  OR user_id = auth.uid()
  OR is_tournament_organizer(tournament_id)
  OR EXISTS (SELECT 1 FROM tournaments t WHERE t.id = tournament_id AND t.visibility = 'public')
);

-- All write paths go through SECURITY DEFINER RPCs; deny direct writes
CREATE POLICY treg_no_direct_write ON tournament_registrations FOR ALL USING (false) WITH CHECK (false);
```

### `tournament_matches`

```sql
CREATE POLICY tmatches_select ON tournament_matches FOR SELECT USING (
  is_admin()
  OR EXISTS (SELECT 1 FROM tournaments t WHERE t.id = tournament_id AND t.visibility = 'public')
  OR is_tournament_organizer(tournament_id)
  OR EXISTS (
    SELECT 1 FROM tournament_registrations r
    WHERE r.tournament_id = tournament_matches.tournament_id AND r.user_id = auth.uid()
  )
);

CREATE POLICY tmatches_no_direct_write ON tournament_matches FOR ALL USING (false) WITH CHECK (false);
```

### `leagues`

```sql
CREATE POLICY leagues_select ON leagues FOR SELECT USING (
  is_admin()
  OR visibility = 'public'
  OR organizer_id = auth.uid()
  OR EXISTS (SELECT 1 FROM league_members m WHERE m.league_id = id AND m.user_id = auth.uid())
  OR (
    visibility = 'community'
    AND community_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM community_members cm
      WHERE cm.community_id = leagues.community_id
        AND cm.user_id = auth.uid()
        AND cm.status = 'active'
    )
  )
);

CREATE POLICY leagues_insert ON leagues FOR INSERT WITH CHECK (organizer_id = auth.uid());
CREATE POLICY leagues_update ON leagues FOR UPDATE USING (
  is_admin() OR is_league_organizer(id)
);
CREATE POLICY leagues_delete ON leagues FOR DELETE USING (
  is_admin() OR organizer_id = auth.uid()
);
```

### `league_members`

```sql
CREATE POLICY lm_select ON league_members FOR SELECT USING (
  is_admin()
  OR user_id = auth.uid()
  OR is_league_organizer(league_id)
  OR is_active_league_member(league_id)
);

CREATE POLICY lm_no_direct_write ON league_members FOR ALL USING (false) WITH CHECK (false);
```

### `seasons` / `sessions` / `session_presence` / `session_matches`

All four tables follow the same pattern:

- **SELECT**: visible to active members of the parent league, plus league organizers, plus public spectators if the league is `public`.
- **WRITE**: deny direct; route through RPCs.

```sql
CREATE POLICY seasons_select ON seasons FOR SELECT USING (
  is_admin()
  OR is_league_organizer(league_id)
  OR is_active_league_member(league_id)
  OR EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND l.visibility = 'public')
);
CREATE POLICY seasons_no_direct_write ON seasons FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY sessions_select ON sessions FOR SELECT USING (
  is_admin()
  OR EXISTS (
    SELECT 1 FROM seasons s JOIN leagues l ON l.id = s.league_id
    WHERE s.id = season_id AND (
      l.visibility = 'public'
      OR is_league_organizer(l.id)
      OR is_active_league_member(l.id)
    )
  )
);
CREATE POLICY sessions_no_direct_write ON sessions FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY session_presence_select ON session_presence FOR SELECT USING (
  is_admin()
  OR user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM sessions ss JOIN seasons s ON s.id = ss.season_id JOIN leagues l ON l.id = s.league_id
    WHERE ss.id = session_id AND (is_league_organizer(l.id) OR is_active_league_member(l.id))
  )
);
CREATE POLICY session_presence_no_direct_write ON session_presence FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY session_matches_select ON session_matches FOR SELECT USING (
  is_admin()
  OR EXISTS (
    SELECT 1 FROM sessions ss JOIN seasons s ON s.id = ss.season_id JOIN leagues l ON l.id = s.league_id
    WHERE ss.id = session_id AND (
      l.visibility = 'public'
      OR is_league_organizer(l.id)
      OR is_active_league_member(l.id)
    )
  )
);
CREATE POLICY session_matches_no_direct_write ON session_matches FOR ALL USING (false) WITH CHECK (false);
```

### `season_rankings`

```sql
CREATE POLICY rankings_select ON season_rankings FOR SELECT USING (
  is_admin()
  OR EXISTS (
    SELECT 1 FROM seasons s JOIN leagues l ON l.id = s.league_id
    WHERE s.id = season_id AND (
      l.visibility = 'public'
      OR is_league_organizer(l.id)
      OR is_active_league_member(l.id)
    )
  )
);
CREATE POLICY rankings_no_direct_write ON season_rankings FOR ALL USING (false) WITH CHECK (false);
```

### `leagues_tournaments_audit`

```sql
CREATE POLICY audit_select ON leagues_tournaments_audit FOR SELECT USING (
  is_admin()
  OR (scope = 'tournament' AND is_tournament_organizer(entity_id))
  OR (scope = 'league' AND is_league_organizer(entity_id))
);

-- Audit rows are written only by triggers / RPCs as SECURITY DEFINER
CREATE POLICY audit_no_direct_write ON leagues_tournaments_audit FOR ALL USING (false) WITH CHECK (false);
```

## Sport-universe enforcement

Every write RPC begins with:

```sql
-- Reject if the active_sport claim is missing — never silently fall back to a default
IF (auth.jwt() -> 'app_metadata' ->> 'active_sport') IS NULL THEN
  RAISE EXCEPTION 'SPORT_MISMATCH';
END IF;

IF (SELECT sport FROM tournaments WHERE id = p_tournament_id) <>
   ((auth.jwt() -> 'app_metadata' ->> 'active_sport')::sport_kind)
THEN
  RAISE EXCEPTION 'SPORT_MISMATCH';
END IF;
```

The mobile client sets `active_sport` in JWT app_metadata on every sport switch (per [02-sport-modes](../02-sport-modes/data-separation.md)).

## Anti-abuse

| Concern                       | Mitigation                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Alt-account registrations     | One registration per user_id per tournament (UNIQUE constraint)                                      |
| Spam tournament creation      | Soft rate limit: 5 tournaments / user / 24h via `auth.users.last_tournament_created_at` check in RPC |
| Bot self-validation of scores | Score validation requires distinct `submitted_by` and `validated_by`                                 |
| Score collusion               | Disputes from any participant flip status to `disputed`; organizer must rule                         |
| Public-bracket scraping       | Realtime channels rate-limited to 50 subs / IP via Supabase project settings                         |
| Reputation laundering         | Reputation events emitted with the same impact as casual matches; no T&L-specific bonus              |
