-- ─────────────────────────────────────────────────────────────────────
-- Run this once in the Supabase SQL Editor, after
-- 2026-09-24_participant_sessions_and_rls.sql.
--
-- Fixes the duplicate-response issue: the same participant must not be able
-- to create more than one participant_responses record for the same
-- conversationId. This does NOT delete responses belonging to different
-- participants - only exact (participantId, conversationId) duplicates from
-- the same participant, keeping the earliest one.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Remove duplicate rows for the same participant + conversation, keeping
--    only the earliest submission (by respondedAt, falling back to ctid).
delete from public.participant_responses a
using public.participant_responses b
where a."participantId" = b."participantId"
  and a."conversationId" = b."conversationId"
  and (
    a."respondedAt" > b."respondedAt"
    or (a."respondedAt" = b."respondedAt" and a.ctid > b.ctid)
  );

-- 2) Enforce the uniqueness going forward. The app now submits with
--    ?on_conflict=participantId,conversationId and
--    Prefer: resolution=ignore-duplicates, which requires this exact
--    constraint to exist.
alter table public.participant_responses
  add constraint participant_responses_participant_conversation_unique
  unique ("participantId", "conversationId");
