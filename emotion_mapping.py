# ─────────────────────────────────────────────────────────────────────
# Shared GoEmotions -> Plutchik/NRC emotion mapping.
#
# This module is imported by BOTH:
#   - emotion_validation.py  (offline research/debug CLI validator)
#   - emotion_api.py         (local inference API used live by the study,
#                              via sentimentAnalysis.js -> app.js)
#
# Keeping the mapping in one place guarantees the same model + the same
# psychological mapping logic powers both the validation script and the
# actual participant study, rather than two implementations drifting
# apart.
#
# Framework grounding:
#   - Plutchik's basic emotion model: joy, sadness, anger, fear, surprise,
#     disgust, trust, anticipation
#   - NRC Emotion Lexicon: positive / negative polarity groupings used to
#     derive overall sentiment
#   - GoEmotions (SamLowe/roberta-base-go_emotions): the probabilistic
#     input layer - 27 emotion labels + neutral - rather than exact
#     keyword matching
#
# The escalation-rule phrase lists (chargeback / security / legal /
# human-request / urgency / confusion) intentionally mirror the phrase
# lists in sentimentAnalysis.js's legacy classifier, so the *rule*
# signals (requestsHuman, mentionsChargeback, securityRisk, legalThreat,
# urgency, confusion) stay the same transparent, auditable rules - only
# the underlying sentiment/emotion intensities feeding escalationRisk
# now come from the real model instead of a hand-built lexicon.
# ─────────────────────────────────────────────────────────────────────

import math
from typing import Any, Dict, Iterable, List

MODEL_NAME = "SamLowe/roberta-base-go_emotions"

GO_EMOTION_LABELS = [
    "admiration", "amusement", "anger", "annoyance", "approval", "caring",
    "confusion", "curiosity", "desire", "disappointment", "disapproval",
    "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief",
    "joy", "love", "nervousness", "optimism", "pride", "realization",
    "relief", "remorse", "sadness", "surprise", "neutral",
]

PLUTCHIK_GROUPS = {
    "anger": ["anger", "annoyance", "disapproval"],
    "frustration": ["annoyance", "disappointment", "anger", "disapproval"],
    "fear": ["fear", "nervousness"],
    "sadness": ["sadness", "grief"],
    "disgust": ["disgust"],
    "joy": ["joy", "love", "gratitude", "relief", "optimism", "approval"],
    "surprise": ["surprise", "realization"],
    "anticipation": ["curiosity", "optimism", "excitement"],
    "trust": ["trust", "approval", "gratitude", "love"],
    "positiveIntensity": ["joy", "gratitude", "approval", "relief", "optimism", "love"],
    "negativeIntensity": ["anger", "annoyance", "disappointment", "sadness", "fear", "disgust"],
}

CHARGEBACK_PHRASES = [
    "chargeback", "charge back", "dispute this charge", "dispute the charge",
    "refund me", "cancel my account", "close my account", "cancel my subscription",
]
SECURITY_PHRASES = [
    "account has been compromised", "account was compromised", "my account is compromised",
    "account was hacked", "my account was hacked", "unauthorized access",
    "someone accessed my account", "someone logged into my account",
]
LEGAL_PHRASES = [
    "lawsuit", "legal action", "sue you", "my lawyer", "my attorney",
    "report this to", "file a complaint", "better business bureau", "bbb complaint",
]
HUMAN_REQUEST_PHRASES = [
    "talk to a human", "speak to a human", "agent", "representative",
    "escalate", "transfer me", "live person", "need a person",
]
URGENCY_WORDS = [
    "asap", "urgent", "urgently", "immediately", "right now", "right away",
    "emergency", "need this now", "time sensitive", "cannot wait", "can't wait", "today",
]
CONFUSION_WORDS = [
    "confused", "confusing", "not sure what", "i don't understand",
    "i do not understand", "makes no sense", "huh",
]

# ── Neutral classification rule (documented) ───────────────────────────
# A customer turn's overall sentiment is "Neutral" - rather than being
# forced into Positive or Negative on any tiny difference - when ANY of
# the following holds:
#
#   1. GoEmotions' own "neutral" label probability is dominant:
#        neutralProbability >= NEUTRAL_LABEL_DOMINANCE_THRESHOLD
#
#   2. Both mapped emotional intensities are low - the message doesn't
#      carry a strong signal either way:
#        positiveIntensity < LOW_INTENSITY_THRESHOLD
#        AND negativeIntensity < LOW_INTENSITY_THRESHOLD
#
#   3. The margin between positive and negative intensity is too small
#      to confidently call a direction:
#        abs(positiveIntensity - negativeIntensity) < SENTIMENT_MARGIN_THRESHOLD
#
# Otherwise: Positive if positiveIntensity > negativeIntensity, else
# Negative.
NEUTRAL_LABEL_DOMINANCE_THRESHOLD = 0.5
LOW_INTENSITY_THRESHOLD = 0.15
SENTIMENT_MARGIN_THRESHOLD = 0.15


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def normalize_go_emotions(raw_output: Any) -> List[Dict[str, float]]:
    if isinstance(raw_output, list) and raw_output and isinstance(raw_output[0], list):
        payload = raw_output[0]
    else:
        payload = raw_output
    if not isinstance(payload, list):
        return []
    items: List[Dict[str, float]] = []
    for entry in payload:
        label = str(entry.get("label", "")).strip().lower()
        score = float(entry.get("score", 0.0) or 0.0)
        if label and score > 0:
            items.append({"label": label, "score": score})
    return sorted(items, key=lambda item: item["score"], reverse=True)


def sum_group(prob_map: Dict[str, float], labels: Iterable[str]) -> float:
    total = 0.0
    for label in labels:
        total += float(prob_map.get(label, 0.0) or 0.0)
    return total


def phrase_exists(text: str, phrases: List[str]) -> bool:
    lowered = text.lower()
    return any(phrase.lower() in lowered for phrase in phrases)


def is_human_request(text: str) -> bool:
    lowered = text.lower()
    return any(phrase in lowered for phrase in HUMAN_REQUEST_PHRASES)


def urgency_score(text: str) -> float:
    lowered = text.lower()
    score = 0.0
    for phrase in URGENCY_WORDS:
        if phrase in lowered:
            score += 0.5
    return min(score, 1.0)


def confusion_score(text: str) -> float:
    lowered = text.lower()
    score = 0.0
    for phrase in CONFUSION_WORDS:
        if phrase in lowered:
            score += 0.5
    return min(score, 1.0)


def derive_overall_sentiment(prob_map: Dict[str, float], positive_intensity: float, negative_intensity: float) -> str:
    neutral_probability = float(prob_map.get("neutral", 0.0) or 0.0)

    if neutral_probability >= NEUTRAL_LABEL_DOMINANCE_THRESHOLD:
        return "Neutral"
    if positive_intensity < LOW_INTENSITY_THRESHOLD and negative_intensity < LOW_INTENSITY_THRESHOLD:
        return "Neutral"
    if abs(positive_intensity - negative_intensity) < SENTIMENT_MARGIN_THRESHOLD:
        return "Neutral"
    if positive_intensity > negative_intensity:
        return "Positive"
    return "Negative"


def build_emotion_profile(go_emotions_raw: Any, text: str) -> Dict[str, Any]:
    """
    Runs the Plutchik/NRC mapping + transparent escalation-rule phrase
    checks over one already-inferred GoEmotions output for one customer
    turn. Returns exactly the object shape the study app expects from
    POST /analyze-emotion (see emotion_api.py) and that
    buildConversationModelAnalysis() in app.js consumes per customer turn.
    """
    normalized = normalize_go_emotions(go_emotions_raw)
    prob_map = {item["label"]: item["score"] for item in normalized}

    mapped = {
        "anger": sum_group(prob_map, PLUTCHIK_GROUPS["anger"]),
        "frustration": sum_group(prob_map, PLUTCHIK_GROUPS["frustration"]),
        "fear": sum_group(prob_map, PLUTCHIK_GROUPS["fear"]),
        "sadness": sum_group(prob_map, PLUTCHIK_GROUPS["sadness"]),
        "disgust": sum_group(prob_map, PLUTCHIK_GROUPS["disgust"]),
        "joy": sum_group(prob_map, PLUTCHIK_GROUPS["joy"]),
        "surprise": sum_group(prob_map, PLUTCHIK_GROUPS["surprise"]),
        "anticipation": sum_group(prob_map, PLUTCHIK_GROUPS["anticipation"]),
        "trust": sum_group(prob_map, PLUTCHIK_GROUPS["trust"]),
        "negativeIntensity": sum_group(prob_map, PLUTCHIK_GROUPS["negativeIntensity"]),
        "positiveIntensity": sum_group(prob_map, PLUTCHIK_GROUPS["positiveIntensity"]),
    }

    positive_intensity = mapped["positiveIntensity"]
    negative_intensity = mapped["negativeIntensity"]

    sentiment_label = derive_overall_sentiment(prob_map, positive_intensity, negative_intensity)
    denom = positive_intensity + negative_intensity
    sentiment_score = 0.0 if denom == 0 else (positive_intensity - negative_intensity) / max(0.0001, denom)

    direct_human_request = is_human_request(text)
    chargeback = phrase_exists(text, CHARGEBACK_PHRASES)
    security_risk = phrase_exists(text, SECURITY_PHRASES)
    legal_threat = phrase_exists(text, LEGAL_PHRASES)

    risk = max(
        0.0,
        min(1.0, mapped["anger"] * 0.5 + mapped["frustration"] * 0.3 + urgency_score(text) * 0.2)
    )
    if direct_human_request:
        risk = max(risk, 0.9)
    if chargeback:
        risk = max(risk, 0.85)
    if security_risk:
        risk = max(risk, 0.95)
    if legal_threat:
        risk = max(risk, 0.95)

    return {
        "sentiment": sentiment_label,
        "sentimentScore": round(float(sentiment_score), 4),
        "frustration": round(float(mapped["frustration"]), 4),
        "anger": round(float(mapped["anger"]), 4),
        "urgency": urgency_score(text),
        "confusion": confusion_score(text),
        "escalationRisk": round(float(risk), 4),
        "requestsHuman": direct_human_request,
        "mentionsChargeback": chargeback,
        "securityRisk": security_risk,
        "legalThreat": legal_threat,
        "rawGoEmotions": normalized,
        "mappedEmotionScores": {k: round(float(v), 4) for k, v in mapped.items()},
    }
