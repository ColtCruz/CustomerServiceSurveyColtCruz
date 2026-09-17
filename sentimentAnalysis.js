// ─────────────────────────────────────────────────────────────────────
// Sentiment Analysis - Deterministic Classifier
//
// This module is the sentiment/risk engine for the handoff (baseline)
// agent. It's fully rule-based right now (no API calls, no cost), but
// it's shaped as a single entry point - classifyMessage(text, state) -
// so a local or hosted model can be dropped in later without changing
// any call site: swap the body of classifyMessage for a real API call
// and everything upstream (baselineEngine.js, app.js) keeps working
// unchanged, since callers already `await` it.
//
// Layers, mirroring a hybrid classifier + rules architecture:
//   1. Word-level valence lexicon (VADER/AFINN-style) - overall sentiment
//   2. Per-dimension phrase lexicons - frustration / anger / urgency / confusion
//   3. ALL-CAPS ("shouting") amplification - raises whichever emotion is present
//   4. Phrase-level rule signals, independent of sentiment - requestsHuman,
//      mentionsChargeback, securityRisk, legalThreat, repeatedComplaint
//   5. issueResolved - reuses the resolution-phrase check from scenarios.js
//
// Conversation-level trend tracking (consecutiveNegativeTurns,
// sentimentDrop, lowestSentimentScore) lives in baselineEngine.js,
// since it needs the running conversation state, not just one message.
// ─────────────────────────────────────────────────────────────────────

// ───────── Overall valence lexicon ─────────

const SENTIMENT_LEXICON = {
  // Negative
  frustrated: -2, frustrating: -2, angry: -3, annoyed: -2, annoying: -2,
  useless: -3, worthless: -3, terrible: -3, worst: -3, hate: -3, awful: -3, horrible: -3,
  ridiculous: -2, unacceptable: -3, disappointed: -2, disappointing: -2,
  confused: -1, confusing: -1, stuck: -1, ignored: -2, waste: -2,
  mad: -2, upset: -2, sucks: -2, broken: -2, wrong: -1, bad: -1,
  slow: -1, difficult: -1, hard: -1, problem: -1, issue: -1, fail: -2,
  failed: -2, failing: -2, joke: -2,
  furious: -3, irritated: -2, irritating: -2, disgusted: -3, disgusting: -3,
  dreadful: -3, pathetic: -3, incompetent: -3, incompetence: -3, unhelpful: -2,
  rude: -2, careless: -2, pointless: -2, hopeless: -3, impossible: -2,
  unreliable: -2, unresponsive: -2, delayed: -1, delay: -1, late: -1,
  overdue: -1, error: -1, errors: -1, bug: -1, bugs: -1, crash: -2,
  crashed: -2, glitch: -1, defective: -2, damaged: -2, missing: -1,
  lost: -2, cancelled: -1, canceled: -1, charged: -1, overcharged: -2,
  scam: -3, fraud: -3, lied: -3, lying: -3, terribly: -3, badly: -2,
  unfair: -2, unsatisfied: -2, dissatisfied: -2, regret: -2, regretful: -2,
  stressful: -2, stressed: -2, worried: -2, concerned: -1, anxious: -2,
  sad: -2, unhappy: -2, miserable: -3, embarrassing: -2, embarrassed: -2,
  offensive: -3, insulting: -3,

  // Positive
  thanks: 2, thank: 2, great: 2, perfect: 3, helpful: 2, appreciate: 2,
  solved: 2, resolved: 2, awesome: 3, wonderful: 3, satisfied: 2,
  happy: 2, good: 1, nice: 1, excellent: 3, works: 1, working: 1,
  amazing: 3, fantastic: 3, brilliant: 3, outstanding: 3, exceptional: 3,
  impressive: 2, pleased: 2, delighted: 3, grateful: 2, thankful: 2,
  relieved: 2, quick: 1, fast: 1, easy: 1, smooth: 2, clear: 1,
  responsive: 2, professional: 2, friendly: 2, kind: 2, patient: 2,
  efficient: 2, reliable: 2, success: 2, successful: 2,
  correct: 1, better: 1, best: 3, love: 3, lovely: 2, glad: 2,

  // Impatience marker - "now" tacked onto a request ("track it NOW",
  // "I need this now") reads as a demand, not a neutral timing word.
  now: -1,

  // Shorthand / texting abbreviations / acronyms common in support chats
  wtf: -3, ugh: -2, smh: -2, ffs: -3, wth: -2, grr: -2, argh: -2,
  meh: -1, idk: -1, asap: -1, np: 1, yay: 2, tyvm: 2, ty: 1,
  omg: -1, omfg: -3, bs: -2, bruh: -1, srsly: -1, rn: -1, pls: 0, plz: 0,
  thx: 1, thnx: 1, tysm: 2, yw: 1, nvm: 0, lol: 0, lmao: 0, rofl: 1,

  // Standalone intensifier used without a following word (e.g. "seriously?!")
  seriously: -1
};

const NEGATION_WORDS = new Set([
  'not', 'no', 'never', "n't", 'cannot', "can't", "isn't", "wasn't", "didn't",
  "won't", "don't", "doesn't", "aren't", "wouldn't", "ain't", "couldn't",
  "shouldn't", "mustn't", "haven't", "hasn't", "hadn't", "weren't", "needn't",
  'hardly', 'barely', 'neither', 'nor', 'without'
]);
const INTENSIFIER_WORDS = {
  very: 1.5, extremely: 2, really: 1.3, so: 1.3, absolutely: 1.8, totally: 1.5,
  incredibly: 1.8, highly: 1.5, deeply: 1.5, especially: 1.3, particularly: 1.3,
  super: 1.5, pretty: 1.2, quite: 1.2, too: 1.4, utterly: 1.8, completely: 1.7,
  entirely: 1.5, seriously: 1.3,
  // Profanity used as an intensifier ("fucking worthless") rather than a
  // standalone lexicon word - it amplifies whatever sentiment word follows
  // instead of carrying a fixed valence of its own (it shows up in both
  // negative - "fucking useless" - and positive - "fucking amazing" - contexts).
  fucking: 1.8, fuckin: 1.8
};
const NEGATION_LOOKBACK_WINDOW = 3;

// ALL-CAPS handling - a message written mostly in capitals reads as
// raised volume/emotion regardless of which words are capitalized.
const SHOUTING_MIN_WORD_LENGTH = 3;   // ignore short caps like "OK", "ID"
const SHOUTING_MIN_CAPS_WORDS = 2;    // don't flag a single capitalized word (e.g. a proper noun)
const SHOUTING_CAPS_RATIO_THRESHOLD = 0.6;
const SHOUTING_MULTIPLIER = 1.5;

function tokenize(text) {
  return text.toLowerCase().match(/[a-z']+/g) || [];
}

// Looks at the ORIGINAL (pre-lowercase) text, since caps detection has
// to happen before case is thrown away.
function isShoutingMessage(text) {
  const words = text.match(/[A-Za-z']+/g) || [];
  const eligibleWords = words.filter((word) => word.length >= SHOUTING_MIN_WORD_LENGTH);
  if (eligibleWords.length === 0) return false;

  const capsWords = eligibleWords.filter((word) => word === word.toUpperCase());
  return capsWords.length >= SHOUTING_MIN_CAPS_WORDS
    && (capsWords.length / eligibleWords.length) >= SHOUTING_CAPS_RATIO_THRESHOLD;
}

// Raw valence score (unbounded integer-ish scale), used internally.
function scoreValence(text) {
  const tokens = tokenize(text);
  let total = 0;

  tokens.forEach((token, index) => {
    const baseScore = SENTIMENT_LEXICON[token];
    if (baseScore === undefined) return;

    const precedingWindow = tokens.slice(Math.max(0, index - NEGATION_LOOKBACK_WINDOW), index);
    const isNegated = precedingWindow.some((word) => NEGATION_WORDS.has(word));
    const intensifier = precedingWindow.reduce((multiplier, word) => (
      INTENSIFIER_WORDS[word] ? INTENSIFIER_WORDS[word] : multiplier
    ), 1);

    total += baseScore * intensifier * (isNegated ? -1 : 1);
  });

  if (total !== 0 && isShoutingMessage(text)) {
    total *= SHOUTING_MULTIPLIER;
  }

  return total;
}

function sentimentLabel(score) {
  // Borderline support-state language like "confused", "cancel my order",
  // and "upset because my refund is stuck" reads as a problem state rather
  // than a strongly negative emotional outburst. Keep clearly hostile or
  // strongly negative language in the negative bucket, but stop classifying
  // these moderate problem statements as outright negative.
  if (score <= -4) return 'negative';
  if (score >= 2) return 'positive';
  return 'neutral';
}

// Normalizes the raw valence sum to a -1..1 scale for display and for
// comparison against fixed thresholds (e.g. sentimentDrop <= -0.5).
const VALENCE_NORMALIZATION_RANGE = 6; // a raw score of +/-6 maps to +/-1
function normalizeScore(rawScore) {
  return Math.max(-1, Math.min(1, rawScore / VALENCE_NORMALIZATION_RANGE));
}

// ───────── Per-dimension phrase lexicons ─────────
// Separate word lists per dimension - frustration and anger are related
// but distinct (anger is hotter/more confrontational), and urgency/
// confusion don't correlate with negativity at all.

const FRUSTRATION_WORDS = [
  'frustrated', 'frustrating', 'annoyed', 'annoying', 'irritated', 'irritating',
  'ridiculous', 'unacceptable', 'waste of time', 'pointless', 'hopeless',
  'sick of this', 'tired of this', 'done with this', 'fed up', 'come on',
  'are you kidding', 'not again', 'ugh', 'smh'
];

const ANGER_WORDS = [
  'angry', 'furious', 'mad', 'pissed', 'hate this', 'disgusted', 'disgusting',
  'outrageous', 'livid', 'wtf', 'ffs', 'this is a joke', 'absolute joke',
  'unbelievable', 'insulting', 'fuck', 'fucking', 'bullshit'
];

const CONFUSION_WORDS = [
  'confused', 'confusing', "don't understand", "do not understand", 'not sure what',
  'lost', 'unclear', 'what does that mean', "i don't get it", 'makes no sense',
  'huh', "i'm not following", 'not following'
];

const URGENCY_WORDS = [
  'asap', 'urgent', 'urgently', 'immediately', 'right now', 'right away',
  'emergency', 'need this now', 'as soon as possible', 'time sensitive',
  "can't wait", 'cannot wait', 'today', 'before'
];

// Saturating count -> 0..1 dimension score: each match adds a fixed
// amount, capped at 1, so a couple of hits register clearly without a
// wall of matches being required to hit the ceiling.
const DIMENSION_MATCH_WEIGHT = 0.4;

// Whole-word match (not a bare substring) so e.g. "time" doesn't match
// inside "sometimes", and "fuck" doesn't match inside "fucking" and
// double up with that entry.
function wordBoundaryIncludes(lowerText, word) {
  const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(lowerText);
}

// Multi-word phrases (e.g. "waste of time") are matched by their
// significant words rather than as one exact substring, so a typo or
// reordering in a short connecting word ("WASTE O FMY FUCKING TIME")
// still counts - these dimension lexicons are heuristic signal, not
// the precise phrase checks used for chargeback/security/legal, so
// some fuzziness here is an acceptable trade for not missing real hits.
//
// Only kicks in once at least two "anchor" words survive filtering -
// a phrase like "come on" or "sick of this" reduces to a single common
// word ("come" / "sick") once filler is stripped, and matching on that
// alone would fire on totally unrelated messages. With fewer than two
// anchors left, fall back to the original exact-phrase substring check.
// Negation words (e.g. "no" in "makes no sense") are always kept as
// anchors regardless of length, since dropping them flips the meaning.
const PHRASE_MATCH_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'my', 'to', 'is', 'am', 'are', 'this', 'that']);

function phraseApproxMatch(lowerText, phrase) {
  const words = phrase.split(' ');
  if (words.length === 1) return wordBoundaryIncludes(lowerText, phrase);

  const significantWords = words.filter((word) => (
    NEGATION_WORDS.has(word) || (word.length > 2 && !PHRASE_MATCH_STOPWORDS.has(word))
  ));
  if (significantWords.length < 2) return lowerText.includes(phrase);

  return significantWords.every((word) => wordBoundaryIncludes(lowerText, word));
}

function scorePhraseDimension(text, phraseList) {
  const lowerText = text.toLowerCase();
  const matchCount = phraseList.reduce((count, phrase) => (
    phraseApproxMatch(lowerText, phrase) ? count + 1 : count
  ), 0);
  const shoutingBoost = isShoutingMessage(text) ? 1.3 : 1;
  return Math.max(0, Math.min(1, matchCount * DIMENSION_MATCH_WEIGHT * shoutingBoost));
}

// ───────── Phrase-level rule signals (independent of sentiment) ─────────
// A calm, politely-worded message can still need a human - these check
// for that regardless of how the sentiment/dimension scores come out.
// requestsHuman and issueResolved reuse HUMAN_REQUEST_PHRASES / RESOLUTION_PHRASES
// and their check functions from scenarios.js (which loads first) rather
// than redefining them here - both engines need the same phrase lists.

// Deliberately action/demand phrases only ("I want X done"), not
// descriptive ones. Earlier this list also included 'charged twice' /
// 'charged me twice' - but that's just describing what happened (it's
// the central fact of the billing-dispute scenario prompt itself), not
// a request for anything - it was firing an unconditional human
// handoff on turn one, before the agent's normal topic reply ever got
// a chance, for anyone who merely explained their situation.
const CHARGEBACK_PHRASES = [
  'chargeback', 'charge back', 'dispute this charge', 'dispute the charge',
  'refund me', 'cancel my account', 'close my account', 'cancel my subscription'
];

const SECURITY_PHRASES = [
  'account has been compromised', 'account was compromised', 'my account is compromised',
  'security compromise', 'account takeover', 'account was hacked', 'my account was hacked',
  'someone hacked my account', 'unauthorized access', 'someone accessed my account',
  'someone logged into my account'
];

const LEGAL_PHRASES = [
  'lawsuit', 'legal action', 'sue you', 'my lawyer', 'my attorney',
  'report this to', 'file a complaint', 'better business bureau', 'bbb complaint'
];

const REPEATED_COMPLAINT_PHRASES = [
  'still not working', 'this is the third time', 'already tried that',
  'you are not listening', 'how many times', 'i already explained',
  'no one is helping', 'waste of time', 'never using this again',
  'this is unacceptable', 'you already said that', 'you just said that',
  'already said that', 'said that already'
];

function levenshteinDistance(wordA, wordB) {
  const m = wordA.length;
  const n = wordB.length;
  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);

  for (let i = 1; i <= m; i++) {
    const currRow = [i];
    for (let j = 1; j <= n; j++) {
      const substitutionCost = wordA[i - 1] === wordB[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,           // deletion
        currRow[j - 1] + 1,       // insertion
        prevRow[j - 1] + substitutionCost
      );
    }
    prevRow = currRow;
  }

  return prevRow[n];
}

// Tolerates a single-character typo (insertion/deletion/substitution) on
// words long enough that one edit can't turn them into a different real
// word ("compromised" / "compromized"). Words under 4 letters require an
// exact match - fuzzing short words risks collisions with common
// unrelated words ("back" / "bank"), which matters more here than in the
// emotion-dimension lexicons since these phrase lists drive an immediate,
// unconditional escalation (mentionsChargeback / securityRisk / legalThreat).
function wordsApproxEqual(wordA, wordB) {
  if (wordA === wordB) return true;
  if (wordA.length < 4 || wordB.length < 4) return false;
  if (Math.abs(wordA.length - wordB.length) > 1) return false;
  return levenshteinDistance(wordA, wordB) <= 1;
}

// Sliding-window phrase match tolerant of single-word typos, but - unlike
// phraseApproxMatch above, used for the emotion dimensions - still
// requires the phrase's words to appear adjacent and in order. That's
// deliberately more conservative than the bag-of-words matching there:
// it catches "my acount was hacked" but won't fire on "charge" and
// "back" showing up in unrelated parts of the same message the way a
// bag-of-words match on "charge back" would.
function containsPhraseTypoTolerant(text, phrase) {
  const textWords = text.toLowerCase().match(/[a-z']+/g) || [];
  const phraseWords = phrase.split(' ');

  for (let start = 0; start <= textWords.length - phraseWords.length; start++) {
    const allMatch = phraseWords.every((phraseWord, offset) => (
      wordsApproxEqual(textWords[start + offset], phraseWord)
    ));
    if (allMatch) return true;
  }
  return false;
}

function containsAnyPhrase(text, phrases) {
  return phrases.some((phrase) => containsPhraseTypoTolerant(text, phrase));
}

// ───────── Main classifier entry point ─────────

// Deliberately `await`-ed by callers even though this resolves
// synchronously today - that's what makes this swappable for a real
// model later without touching baselineEngine.js or app.js.
function classifyMessage(text) {
  const rawValence = scoreValence(text);
  const requestsHuman = containsHumanRequest(text);
  const repeatedComplaint = containsAnyPhrase(text, REPEATED_COMPLAINT_PHRASES);

  // A message can carry a clear negative signal with zero lexicon hits -
  // e.g. "TALK TO A HUMAN NOW!" has no word in SENTIMENT_LEXICON at all,
  // so word-level scoring alone would call it neutral. Only nudge when
  // the lexicon found nothing, so a message that already scored on its
  // own words isn't double-counted.
  let adjustedValence = rawValence;
  if (adjustedValence === 0) {
    if (isShoutingMessage(text)) adjustedValence -= 2;
    if (requestsHuman || repeatedComplaint) adjustedValence -= 1;
  }

  const sentimentScore = normalizeScore(adjustedValence);

  return {
    sentiment: sentimentLabel(adjustedValence),
    sentimentScore,
    frustration: scorePhraseDimension(text, FRUSTRATION_WORDS),
    anger: scorePhraseDimension(text, ANGER_WORDS),
    urgency: scorePhraseDimension(text, URGENCY_WORDS),
    confusion: scorePhraseDimension(text, CONFUSION_WORDS),
    escalationRisk: 0, // filled in below once frustration/anger/urgency are known
    issueResolved: containsResolutionPhrase(text),
    requestsHuman,
    mentionsChargeback: containsAnyPhrase(text, CHARGEBACK_PHRASES),
    securityRisk: containsAnyPhrase(text, SECURITY_PHRASES),
    legalThreat: containsAnyPhrase(text, LEGAL_PHRASES),
    repeatedComplaint
  };
}

// escalationRisk is a holistic read of the other dimensions - computed
// after the fact so it can weigh frustration/anger/urgency together,
// the same way a model would be asked to give one summary risk score.
function withEscalationRisk(result) {
  const escalationRisk = Math.max(0, Math.min(1,
    result.anger * 0.5 + result.frustration * 0.3 + result.urgency * 0.2
  ));
  return { ...result, escalationRisk };
}

function classify(text) {
  return withEscalationRisk(classifyMessage(text));
}

// ─────────────────────────────────────────────────────────────────────
// Psychological emotion analysis - PRIMARY source for the dataset study
//
// buildConversationModelAnalysis() in app.js (the dataset-study pipeline
// that produces the sentiment/escalation results participants see) calls
// analyzeCustomerTurnWithGoEmotions() below for every customer turn,
// instead of the legacy classify() lexicon classifier. classify()/
// classifyMessage() above remain in place only for the live practice
// chat simulation (baselineEngine.js / failsafeEngine.js), which is a
// separate flow from the dataset study.
//
// Architecture: customer turn -> GoEmotions (SamLowe/roberta-base-go_emotions,
// run server-side by emotion_api.py, see analyzeCustomerTurnWithGoEmotions)
// -> Plutchik/NRC psychological mapping -> sentiment/emotion scores ->
// the same transparent escalation rules as before (shouldEscalate() in
// failsafeEngine.js, and the equivalent inline checks in
// buildConversationModelAnalysis). Only customer turns are analyzed;
// agent turns are never sent through this pipeline.
//
// Framework grounding:
//   - Plutchik's basic emotion model: joy, sadness, anger, fear, surprise,
//     disgust, trust, anticipation
//   - NRC Emotion Lexicon: positive / negative polarity and emotion word
//     categories for the result mapping
//   - GoEmotions: contextual emotion classification model used as the
//     probabilistic input layer, rather than exact keyword matching only
//
// The goal of this layer is transparency: preserve the raw GoEmotions output,
// then map it into explainable dimensions that can be compared against the
// existing escalation rules. Agent turns are explicitly excluded.
// ─────────────────────────────────────────────────────────────────────

const GO_EMOTION_LABELS = [
  'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring', 'confusion',
  'curiosity', 'desire', 'disappointment', 'disgust', 'embarrassment', 'excitement',
  'fear', 'gratitude', 'grief', 'joy', 'love', 'nervousness', 'optimism', 'pride',
  'realization', 'relief', 'remorse', 'sadness', 'surprise', 'neutral'
];

const GO_EMOTION_TO_PLUTCHIK = {
  anger: ['anger', 'annoyance', 'disapproval'],
  frustration: ['annoyance', 'disappointment', 'anger', 'disapproval'],
  fear: ['fear', 'nervousness'],
  sadness: ['sadness', 'grief'],
  disgust: ['disgust'],
  joy: ['joy', 'love', 'gratitude', 'relief', 'optimism', 'approval'],
  surprise: ['surprise', 'realization'],
  anticipation: ['anticipation', 'curiosity', 'optimism'],
  trust: ['trust', 'approval', 'gratitude', 'love'],
  negativeIntensity: ['anger', 'annoyance', 'disappointment', 'sadness', 'fear', 'disgust'],
  positiveIntensity: ['joy', 'gratitude', 'approval', 'relief', 'optimism', 'love'],
  nrcPositive: ['joy', 'gratitude', 'approval', 'relief', 'optimism', 'love', 'trust'],
  nrcNegative: ['anger', 'annoyance', 'disappointment', 'sadness', 'fear', 'disgust'],
  nrcFear: ['fear', 'nervousness'],
  nrcTrust: ['trust', 'approval', 'gratitude', 'love']
};

function normalizeGoEmotionOutput(rawGoEmotionOutput) {
  if (!Array.isArray(rawGoEmotionOutput)) return [];
  return rawGoEmotionOutput
    .map((entry) => {
      const label = String(entry && entry.label ? entry.label : '').trim().toLowerCase();
      const score = Number(entry && entry.score !== undefined ? entry.score : 0);
      return { label, score: Number.isFinite(score) ? score : 0 };
    })
    .filter((entry) => entry.label && entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

function sumEmotionProbabilities(goEmotionScores, labels) {
  return labels.reduce((total, label) => total + (Number(goEmotionScores[label]) || 0), 0);
}

function deriveOverallSentimentFromPsychology(positiveIntensity, negativeIntensity) {
  if (positiveIntensity > negativeIntensity) return 'Positive';
  if (negativeIntensity > positiveIntensity) return 'Negative';
  return 'Neutral';
}

function buildPsychologicalEmotionProfile(rawGoEmotionOutput, text) {
  const normalizedOutputs = normalizeGoEmotionOutput(rawGoEmotionOutput);
  const goEmotionScores = Object.fromEntries(normalizedOutputs.map((entry) => [entry.label, entry.score]));

  const anger = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.anger);
  const frustration = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.frustration);
  const fear = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.fear);
  const sadness = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.sadness);
  const disgust = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.disgust);
  const joy = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.joy);
  const surprise = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.surprise);
  const anticipation = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.anticipation);
  const trust = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.trust);

  const negativeIntensity = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.negativeIntensity);
  const positiveIntensity = sumEmotionProbabilities(goEmotionScores, GO_EMOTION_TO_PLUTCHIK.positiveIntensity);

  const overallSentiment = deriveOverallSentimentFromPsychology(positiveIntensity, negativeIntensity);
  const sentimentScore = (positiveIntensity - negativeIntensity) / Math.max(0.0001, positiveIntensity + negativeIntensity);

  const directHumanRequest = Boolean(containsHumanRequest(String(text || '')));
  const chargeback = Boolean(containsAnyPhrase(String(text || ''), CHARGEBACK_PHRASES));
  const securityRisk = Boolean(containsAnyPhrase(String(text || ''), SECURITY_PHRASES));
  const legalThreat = Boolean(containsAnyPhrase(String(text || ''), LEGAL_PHRASES));

  const urgency = scorePhraseDimension(String(text || ''), URGENCY_WORDS);
  const confusion = scorePhraseDimension(String(text || ''), CONFUSION_WORDS);

  const legacyEscalationRisk = Math.max(0, Math.min(1,
    anger * 0.5 + frustration * 0.3 + urgency * 0.2
  ));

  const escalationRisk = Math.max(
    legacyEscalationRisk,
    directHumanRequest ? 0.9 : 0,
    chargeback ? 0.85 : 0,
    securityRisk ? 0.95 : 0,
    legalThreat ? 0.95 : 0
  );

  return {
    rawGoEmotions: normalizedOutputs,
    mappedPlutchik: {
      anger,
      frustration,
      fear,
      sadness,
      disgust,
      joy,
      surprise,
      anticipation,
      trust
    },
    mappedResearchDimensions: {
      anger,
      frustration,
      fear,
      sadness,
      disgust,
      joy,
      surprise,
      anticipation,
      trust,
      negativeEmotionalIntensity: negativeIntensity,
      positiveEmotionalIntensity: positiveIntensity,
      overallSentiment,
      sentimentScore,
      urgency,
      confusion,
      escalationRisk: Math.min(1, Number(escalationRisk) || 0)
    },
    ruleFlags: {
      directHumanRequest,
      chargeback,
      securityRisk,
      legalThreat
    }
  };
}

// buildPsychologicalEmotionProfile stays available for in-browser mapping of an
// already-fetched raw GoEmotions array, but the live study path below calls the
// local inference API directly, since the mapping happens server-side there
// (emotion_mapping.py - the same mapping logic, kept in one place).

// ─────────────────────────────────────────────────────────────────────
// Live GoEmotions inference API client - primary classifier for the study
//
// The browser can't run the Transformers pipeline itself, so a small local
// Flask server (emotion_api.py) loads SamLowe/roberta-base-go_emotions once
// and exposes POST /analyze-emotion. This function calls it for one customer
// turn and returns the object buildConversationModelAnalysis() expects.
//
// Deliberately NO fallback to classify() here: if the real model inference
// is unavailable, the study must not silently substitute the old lexicon
// classifier and present its output as if it were GoEmotions-backed. Callers
// must let this rejection propagate and show a study-unavailable/developer
// error instead (see loadDatasetQualityStudy() in app.js).
// ─────────────────────────────────────────────────────────────────────

const EMOTION_API_BASE_URL = 'http://127.0.0.1:5001';

const REQUIRED_EMOTION_ANALYSIS_FIELDS = [
  'sentiment', 'sentimentScore', 'frustration', 'anger', 'urgency', 'confusion',
  'escalationRisk', 'requestsHuman', 'mentionsChargeback', 'securityRisk',
  'legalThreat', 'rawGoEmotions', 'mappedEmotionScores'
];

async function analyzeCustomerTurnWithGoEmotions(text) {
  let response;
  try {
    response = await fetch(`${EMOTION_API_BASE_URL}/analyze-emotion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text || '') })
    });
  } catch (networkError) {
    throw new Error(
      `Could not reach the GoEmotions analysis API at ${EMOTION_API_BASE_URL}. ` +
      `Start it with "python emotion_api.py" from the CustomerAgent directory. (${networkError.message})`
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      const errorBody = await response.json();
      detail = errorBody && errorBody.error ? ` - ${errorBody.error}` : '';
    } catch (_parseError) {
      // response body wasn't JSON - fall through with no extra detail
    }
    throw new Error(`GoEmotions analysis API returned HTTP ${response.status}${detail}`);
  }

  const result = await response.json();
  const missingFields = REQUIRED_EMOTION_ANALYSIS_FIELDS.filter((field) => !(field in result));
  if (missingFields.length) {
    throw new Error(`GoEmotions analysis API response is missing required field(s): ${missingFields.join(', ')}`);
  }

  return result;
}

