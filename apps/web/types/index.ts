/**
 * Database types for the web app.
 *
 * This used to be a second `supabase gen types` output, generated from the *same*
 * Supabase project as packages/shared-types — two copies of one schema, drifting apart
 * whenever only one was regenerated. They did: this file still described
 * player_availability with the pre-hourly `period_enum` shape and was missing ~37
 * tables, so writes typed against it were rejected by the live table.
 *
 * It is now a re-export of the single source of truth. Regenerate with
 * `npm run db:generate-types:local` from the repo root (never from staging or prod).
 *
 * The `@/types` alias is kept so existing imports keep working; new code may import
 * from either, since they now resolve to the same types.
 */
export type {
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  Json,
} from '@rallia/shared-types';
