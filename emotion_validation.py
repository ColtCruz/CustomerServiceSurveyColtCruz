# ─────────────────────────────────────────────────────────────────────
# Research validation CLI for the GoEmotions-backed emotion classifier.
#
# This script is kept as a standalone tool for offline validation: run
# it directly to see raw model output + mapped Plutchik/NRC dimensions
# for a fixed set of sample messages and for the first 10 conversations
# in the live dataset study pulls from.
#
# It imports its model name and all mapping/rule logic from
# emotion_mapping.py - the SAME module emotion_api.py uses to serve the
# actual participant study. That means this script validates the exact
# logic the live study runs on, not a separate copy of it.
# ─────────────────────────────────────────────────────────────────────

import json
import urllib.request
from typing import Any, Dict, List

from transformers import pipeline

from emotion_mapping import MODEL_NAME, build_emotion_profile

HF_DATASET_URL = "https://huggingface.co/datasets/ai-training-datasets/customer-service/resolve/main/dataset_customer_service.json"


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


DEBUG_SAMPLE_MESSAGES = [
    "I am furious that my refund is still missing after a week.",
    "This is ridiculous, I need my account cancelled today.",
    "I am confused and do not understand why my order was never shipped.",
    "This is urgent, I need this resolved immediately.",
    "My account was hacked and someone accessed my banking details.",
    "I am upset and need to speak to a human right now.",
    "I am really disappointed the service still failed after I already tried twice.",
    "Thank you, you solved it and I am relieved.",
    "I am scared this chargeback will be reported to a lawyer.",
    "I love how quickly you fixed this and I am grateful.",
    "I am not sure why the refund is delayed and this makes no sense.",
    "This is a total disaster and it feels like a scam.",
    "I appreciate the quick response and the fix worked.",
    "I am nervous because the package is lost and no one is helping.",
    "I am deeply frustrated and the support team is useless.",
    "I am optimistic this can still be fixed, but I am worried.",
    "I need a human representative to review my chargeback request.",
    "I am relieved the issue is finally resolved and the update was clear.",
    "The order was cancelled without my consent and I want this disputed immediately.",
    "This is neutral and I just want an update on my order status.",
]


def load_dataset() -> List[Dict[str, Any]]:
    with urllib.request.urlopen(HF_DATASET_URL, timeout=60) as response:
        data = json.load(response)

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        conversations = data.get("conversations")
        if isinstance(conversations, list):
            return conversations
        for key in ["data", "train", "rows", "records"]:
            value = data.get(key)
            if isinstance(value, list):
                return value
        for value in data.values():
            if isinstance(value, list):
                return value
    return []


def flatten_dataset_conversations(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    conversations: List[Dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        turns: List[Dict[str, Any]] = []
        if isinstance(record.get("dialogue"), list):
            turns = record["dialogue"]
        elif isinstance(record.get("turns"), list):
            turns = record["turns"]
        elif isinstance(record.get("conversation"), list):
            turns = record["conversation"]
        elif isinstance(record.get("messages"), list):
            turns = record["messages"]

        cleaned_turns = []
        for turn in turns:
            if not isinstance(turn, dict):
                continue
            text = normalize_text(turn.get("text") or turn.get("message") or turn.get("content") or turn.get("customer_message") or turn.get("customerText") or "")
            role = str(turn.get("role") or turn.get("speaker") or turn.get("author") or turn.get("sender") or "customer").lower()
            if not text:
                continue
            cleaned_turns.append({"role": role, "text": text, "turnNumber": len(cleaned_turns) + 1})

        if len(cleaned_turns) >= 2 and any(t["role"] == "customer" for t in cleaned_turns):
            conversations.append({
                "conversationId": record.get("conversation_id") or record.get("id") or record.get("conversationId") or f"conv_{len(conversations)}",
                "title": record.get("issueType") or record.get("problem") or record.get("topic") or record.get("domain") or "Customer service conversation",
                "turns": cleaned_turns,
            })
    return conversations


def main() -> None:
    print(f"Loading GoEmotions model ({MODEL_NAME})...")
    model = pipeline("text-classification", model=MODEL_NAME, top_k=None, truncation=True)

    print("\n=== 20 sample customer-service messages ===")
    for index, message in enumerate(DEBUG_SAMPLE_MESSAGES, start=1):
        result = model(message, truncation=True)
        profile = build_emotion_profile(result, message)
        print(f"\n[{index}] {message}")
        print("raw_go_emotions_top8:", [(item["label"], round(item["score"], 4)) for item in profile['rawGoEmotions'][:8]])
        print("mapped:", profile['mappedEmotionScores'])
        print("sentiment:", profile["sentiment"], "score:", profile["sentimentScore"], "risk:", profile["escalationRisk"])

    print("\n=== 10 actual dataset conversations (used by the participant study) ===")
    records = load_dataset()
    conversations = flatten_dataset_conversations(records)[:10]
    if not conversations:
        raise RuntimeError("No customer conversations were loaded from the dataset.")

    validation_rows = []
    for conversation in conversations:
        print(f"\nConversation: {conversation['conversationId']} | {conversation['title']}")
        customer_turns = [turn for turn in conversation["turns"] if str(turn.get("role", "")).lower() == "customer"]
        analyzed_turns = 0
        last_profile = None
        for turn in customer_turns:
            text = turn["text"]
            result = model(text, truncation=True)
            profile = build_emotion_profile(result, text)
            analyzed_turns += 1
            last_profile = profile
            print(f"  Turn {turn['turnNumber']}: {text[:160]}")
            print(f"    raw: {[(item['label'], round(item['score'], 4)) for item in profile['rawGoEmotions'][:6]]}")
            print(f"    mapped: {profile['mappedEmotionScores']}")
            print(f"    sentiment: {profile['sentiment']} | sentimentScore={profile['sentimentScore']} | escalationRisk={profile['escalationRisk']}")

        validation_rows.append({
            "conversationId": conversation["conversationId"],
            "customerTurns": len(customer_turns),
            "analyzedTurns": analyzed_turns,
            "sentiment": last_profile["sentiment"] if last_profile else None,
            "sentimentScore": last_profile["sentimentScore"] if last_profile else None,
            "hasRawGoEmotions": bool(last_profile and last_profile["rawGoEmotions"]),
            "hasMappedEmotionScores": bool(last_profile and last_profile["mappedEmotionScores"]),
        })

    print("\n=== Validation summary (matches the study's required per-conversation checks) ===")
    header = f"{'conversationId':<14}{'customerTurns':<15}{'analyzedTurns':<15}{'sentiment':<10}{'sentimentScore':<16}{'hasRawGoEmotions':<18}{'hasMappedEmotionScores'}"
    print(header)
    for row in validation_rows:
        print(f"{str(row['conversationId']):<14}{row['customerTurns']:<15}{row['analyzedTurns']:<15}{str(row['sentiment']):<10}{row['sentimentScore']:<16}{str(row['hasRawGoEmotions']):<18}{row['hasMappedEmotionScores']}")

    print("\nValidation complete.")


if __name__ == "__main__":
    main()
