-- Add bilingual title and prize description columns to referral_contest.
-- Nullable so existing rows are preserved; backfilled from original columns.
alter table public.referral_contest
  add column title_en text,
  add column title_fr text,
  add column prize_description_en text,
  add column prize_description_fr text;

-- Backfill: treat original title/prize_description as English content
update public.referral_contest
set
  title_en = title,
  prize_description_en = prize_description;
