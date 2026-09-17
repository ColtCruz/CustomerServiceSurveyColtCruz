#!/usr/bin/env python3
"""
Builds the canonical 25-conversation study dataset with full customer+agent
transcripts, for the participant/professional-reviewer study.

Sources from ai-training-datasets/customer-service (100 templated but
coherent, English-only support conversations, 11 turns each). This replaced
an earlier attempt built on Katipezi/customer_support_conversations_dataset,
which turned out to be unusable for a human-judgment study - many
conversations code-switch into Hindi even when tagged "en", and the agent
turns are templated in a way that repeats verbatim regardless of what the
customer just said (visibly incoherent, not just noisy).

Selects 25 conversations spread across the 15 "problem" categories and 6
"customer_type" personas in this dataset, for topical/persona diversity
without needing sentiment/urgency labels (this dataset doesn't have any).

Run from the CustomerAgent directory:
    ../.venv/Scripts/python.exe research/build_study_dataset.py
"""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / 'research' / 'study_conversations.json'
DATASET_URL = 'https://huggingface.co/datasets/ai-training-datasets/customer-service/resolve/main/dataset_customer_service.json'
SELECTION_LIMIT = 25

PUNCTUATION_RE = re.compile(r'[.!?]')


def trim_trailing_gibberish(raw_text):
    raw = (raw_text or '').strip()
    if not raw:
        return raw
    matches = list(PUNCTUATION_RE.finditer(raw))
    if not matches:
        return raw
    last_index = matches[-1].end() - 1
    return raw[:last_index + 1].strip()


def load_dataset_records():
    with urllib.request.urlopen(DATASET_URL) as response:
        payload = json.loads(response.read().decode('utf-8'))
    return payload if isinstance(payload, list) else payload.get('conversations', [])


def select_diverse_conversations(records, limit=SELECTION_LIMIT):
    # Round-robin over the 15 "problem" categories (not the 90 possible
    # problem x customer_type combinations - with only 25 slots, topic
    # coverage matters more than persona coverage, and round-robining over
    # every combination would exhaust the alphabetically-early problems
    # before ever reaching the rest). Pass 1 gives all 15 problems one
    # conversation each; pass 2 gives 10 of them a second, sorted by
    # customer_type so the second pick tends to be a different persona
    # than the first.
    by_problem = {}
    for record in records:
        by_problem.setdefault(record.get('problem'), []).append(record)
    for problem_records in by_problem.values():
        problem_records.sort(key=lambda r: r.get('customer_type') or '')

    problems = sorted(by_problem.keys())
    ordered = []
    while len(ordered) < limit and any(by_problem[problem] for problem in problems):
        for problem in problems:
            if by_problem[problem]:
                ordered.append(by_problem[problem].pop(0))
                if len(ordered) >= limit:
                    break
    return ordered[:limit]


def build_conversation(record):
    turns = []
    for turn_number, raw_turn in enumerate(record.get('dialogue', []), start=1):
        role = (raw_turn.get('role') or '').strip().lower()
        raw_text = (raw_turn.get('text') or '').strip()
        if not raw_text:
            continue
        turns.append({
            'turnNumber': turn_number,
            'role': 'agent' if role == 'agent' else 'customer',
            'text': trim_trailing_gibberish(raw_text),
            'textRaw': raw_text
        })

    return {
        'conversationId': str(record.get('id')),
        'issueType': (record.get('problem') or 'general').strip() or 'general',
        'industry': (record.get('domain') or 'customer service').strip() or 'customer service',
        'product': 'unknown',
        'channel': 'unknown',
        'language': 'en',
        'customerType': (record.get('customer_type') or 'unknown').strip() or 'unknown',
        'resolution': (record.get('resolution') or '').strip(),
        'turns': turns
    }


def main():
    records = load_dataset_records()
    selected = select_diverse_conversations(records)
    conversations = [build_conversation(record) for record in selected]

    OUTPUT_PATH.write_text(json.dumps(conversations, indent=2), encoding='utf-8')
    print(f'Wrote {len(conversations)} conversations to {OUTPUT_PATH}')
    for conv in conversations:
        customer_turns = sum(1 for t in conv['turns'] if t['role'] == 'customer')
        agent_turns = sum(1 for t in conv['turns'] if t['role'] == 'agent')
        print(f"  {conv['conversationId']} ({conv['issueType']} / {conv['customerType']}): {customer_turns} customer turns, {agent_turns} agent turns")


if __name__ == '__main__':
    main()
