# Security phrase correction — 2026-10-06

The existing security-risk rule missed the wording `account hacked` because its phrase lists only included longer variants such as `account was hacked`. Added the shortened phrase to both Python and JavaScript mappings.

Replayed all 25 conversations through the existing precomputation decision logic using their saved per-turn inference outputs, updating security detection and its risk floor only. No GoEmotions probabilities, emotion mappings, sentiment scores, thresholds, transcripts, or human responses were changed. Only conversation IDs 6 and 48 changed, both from No to Yes, for the existing security-risk condition. ID 6 triggers on customer turn 1. The AI handoff rate is now 5/25 (20%) instead of 3/25 (12%). Agreement percentages must be recalculated against the human records.

The original analysis is preserved in `ai_analysis_25.before_security_phrase_fix_20261006.json`. Treat this as a documented post-collection implementation correction. The security condition is a phrase-based safety rule, not a GoEmotions emotion prediction.
