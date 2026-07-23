-- Reply rates for the in-app user-interview outreach campaign, by segment.
--
-- A "reply" = any message the recipient posted in the outreach thread AFTER our
-- message landed. Founders' own messages are excluded by identifying the single
-- non-founder participant of each campaign conversation.
--
-- Read rate_1h, not rate_ever, when comparing waves of different ages: a wave sent
-- an hour ago has had no chance to accumulate the replies a month-old wave has.
-- rate_1h normalises that by asking "how many had replied within 1h of THEIR send".
--
-- Run against prod (ncewkeoohdkpbcovbppd). Read-only.

with founders as (
  select id from profile where email in ('lefrancmathis@gmail.com','jdl.sonkin@gmail.com')
),
-- one row per outreach thread: which segment, and when we sent
sent as (
  select m.conversation_id, m.metadata->>'segment' as segment, min(m.created_at) as sent_at
  from message m
  where m.metadata->>'campaign' = 'user_interview_outreach'
  group by m.conversation_id, m.metadata->>'segment'
),
-- the non-founder participant of each thread is the recipient
recipient as (
  select s.conversation_id, cp.player_id
  from sent s
  join conversation_participant cp on cp.conversation_id = s.conversation_id
  where cp.player_id not in (select id from founders)
),
first_reply as (
  select s.conversation_id, min(m.created_at) as replied_at
  from sent s
  join recipient r on r.conversation_id = s.conversation_id
  join message m on m.conversation_id = s.conversation_id
  where m.sender_id = r.player_id and m.created_at > s.sent_at
  group by s.conversation_id
)
select
  s.segment,
  count(*) as sent,
  round(extract(epoch from (now() - max(s.sent_at)))/3600)::int as hours_since_send,
  count(*) filter (where fr.replied_at is not null) as replied_ever,
  round(100.0 * count(*) filter (where fr.replied_at is not null) / count(*), 1) as rate_ever,
  count(*) filter (where fr.replied_at <= s.sent_at + interval '1 hour') as replied_1h,
  round(100.0 * count(*) filter (where fr.replied_at <= s.sent_at + interval '1 hour') / count(*), 1) as rate_1h,
  count(*) filter (where fr.replied_at <= s.sent_at + interval '24 hours') as replied_24h,
  round(100.0 * count(*) filter (where fr.replied_at <= s.sent_at + interval '24 hours') / count(*), 1) as rate_24h
from sent s
left join first_reply fr on fr.conversation_id = s.conversation_id
group by s.segment
order by rate_24h desc, s.segment;
