#!/usr/bin/env python3
import csv
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from huggingface_hub import snapshot_download
from transformers import pipeline

ROOT = Path(__file__).resolve().parent.parent
RESULT_PATH = ROOT / 'research' / 'research_results.json'
NODE_SCRIPT = ROOT / 'research' / 'research_eval_node.js'

POSITIVE_LABELS = {
    'joy', 'love', 'gratitude', 'admiration', 'optimism', 'approval',
    'amusement', 'excitement', 'relief', 'pride', 'caring'
}
NEGATIVE_LABELS = {
    'anger', 'annoyance', 'disappointment', 'disgust', 'sadness', 'fear',
    'nervousness', 'disapproval', 'grief', 'embarrassment', 'remorse'
}
NEUTRAL_LABELS = {'neutral', 'realization', 'surprise', 'curiosity', 'desire', 'confusion'}


def normalize_dataset_sentiment(value):
    value = (value or '').strip().lower()
    return value if value in {'positive', 'negative', 'neutral'} else 'neutral'


def normalize_hf_label(label):
    label = (label or '').strip().lower()
    if label in POSITIVE_LABELS:
        return 'positive'
    if label in NEGATIVE_LABELS:
        return 'negative'
    if label in NEUTRAL_LABELS or not label:
        return 'neutral'
    return 'neutral'


def load_dataset_rows():
    repo_path = snapshot_download(
        repo_id='Katipezi/customer_support_conversations_dataset',
        repo_type='dataset',
        allow_patterns=['*']
    )
    csv_path = os.path.join(repo_path, 'customer_support_data.csv')
    rows = []
    with open(csv_path, newline='', encoding='utf-8') as csv_file:
        reader = csv.DictReader(csv_file)
        for row in reader:
            rows.append(row)
    return rows


def select_diverse_conversations(rows, limit=25):
    by_conv = defaultdict(list)
    for row in rows:
        text = (row.get('text') or '').strip()
        if row.get('role') == 'customer' and text:
            by_conv[row['conv_id']].append(row)

    convs = []
    for conv_id, conv_rows in by_conv.items():
        customer_rows = sorted(conv_rows, key=lambda item: int(item.get('turn_index', 0)))
        if not customer_rows:
            continue
        first = customer_rows[0]
        convs.append({
            'conv_id': conv_id,
            'issue_type': (first.get('issue_type') or 'general').strip() or 'general',
            'overall_sentiment': normalize_dataset_sentiment(first.get('overall_sentiment')),
            'overall_urgency': (first.get('overall_urgency') or 'medium').strip() or 'medium',
            'outcome': (first.get('outcome') or 'unknown').strip() or 'unknown',
            'messages': [row['text'].strip() for row in customer_rows if (row.get('text') or '').strip()],
            'language': (first.get('language') or 'unknown').strip() or 'unknown',
            'industry': (first.get('industry') or 'unknown').strip() or 'unknown',
            'product': (first.get('product') or 'unknown').strip() or 'unknown',
            'channel': (first.get('channel') or 'unknown').strip() or 'unknown'
        })

    ordered = []
    seen = set()
    for key in sorted({(conv['issue_type'], conv['overall_sentiment']) for conv in convs}):
        for conv in convs:
            if (conv['issue_type'], conv['overall_sentiment']) == key and conv['conv_id'] not in seen:
                ordered.append(conv)
                seen.add(conv['conv_id'])
                if len(ordered) >= limit:
                    return ordered

    for conv in convs:
        if conv['conv_id'] not in seen:
            ordered.append(conv)
            seen.add(conv['conv_id'])
            if len(ordered) >= limit:
                break
    return ordered[:limit]


def run_agent_for_messages(messages):
    payload = json.dumps({'messages': messages})
    result = subprocess.run(
        ['node', str(NODE_SCRIPT), payload],
        capture_output=True,
        text=True,
        check=True,
        cwd=str(ROOT)
    )
    return json.loads(result.stdout)


def get_top_hf_label(model_output):
    if isinstance(model_output, list) and model_output and isinstance(model_output[0], dict):
        return model_output[0]['label']
    if isinstance(model_output, dict):
        return model_output.get('label')
    return 'neutral'


def build_case_record(case, hf_outputs):
    agent_result = run_agent_for_messages(case['messages'])
    turns = []
    for index, message in enumerate(case['messages'], start=1):
        raw_hf_entry = hf_outputs[index - 1] if index - 1 < len(hf_outputs) else []
        hf_label = get_top_hf_label(raw_hf_entry)
        agent_turn = agent_result['turns'][index - 1]
        turns.append({
            'turn': index,
            'customerMessage': message,
            'datasetOverallSentiment': case['overall_sentiment'],
            'hfTopEmotion': hf_label,
            'hfSentimentBucket': normalize_hf_label(hf_label),
            'agentSentiment': agent_turn['agentSentiment'],
            'agentSentimentScore': agent_turn['agentSentimentScore'],
            'agentEscalationRisk': agent_turn['agentEscalationRisk'],
            'agentEscalated': agent_turn['agentEscalated'],
            'handoffTriggered': agent_turn['handoffTriggered'],
            'sentimentMatched': normalize_hf_label(hf_label) == agent_turn['agentSentiment']
        })

    escalated_turn = agent_result.get('escalatedTurn')
    last_agent_sentiment = turns[-1]['agentSentiment'] if turns else 'neutral'
    overall_match = case['overall_sentiment'] == last_agent_sentiment

    return {
        'conversationId': case['conv_id'],
        'issueType': case['issue_type'],
        'language': case['language'],
        'industry': case['industry'],
        'product': case['product'],
        'channel': case['channel'],
        'datasetSentiment': case['overall_sentiment'],
        'datasetPriority': case['overall_urgency'],
        'datasetStatus': case['outcome'],
        'agentSentimentClassification': last_agent_sentiment,
        'agentEscalationDecision': agent_result.get('finalEscalated', False),
        'escalationTurn': escalated_turn,
        'sentimentClassificationsMatched': overall_match,
        'hfTopEmotion': turns[-1]['hfTopEmotion'],
        'hfSentimentBucket': turns[-1]['hfSentimentBucket'],
        'turns': turns,
        'comparisonSummary': {
            'datasetSentiment': case['overall_sentiment'],
            'agentSentiment': last_agent_sentiment,
            'datasetPriority': case['overall_urgency'],
            'datasetStatus': case['outcome'],
            'agentEscalationDecision': agent_result.get('finalEscalated', False),
            'escalationTurn': escalated_turn,
            'sentimentMatched': overall_match
        }
    }


def build_summary(cases):
    dataset_sentiment = Counter(case['datasetSentiment'] for case in cases)
    hf_bucket = Counter(case['hfSentimentBucket'] for case in cases)
    agent_bucket = Counter(case['agentSentimentClassification'] for case in cases)
    escalations = sum(1 for case in cases if case['agentEscalationDecision'])
    return {
        'totalCases': len(cases),
        'datasetSentiment': dict(dataset_sentiment),
        'hfSentimentBuckets': dict(hf_bucket),
        'agentSentimentBuckets': dict(agent_bucket),
        'escalations': escalations,
        'escalationRate': round(escalations / len(cases), 3) if cases else 0,
        'sentimentMatchRate': round(sum(1 for case in cases if case['sentimentClassificationsMatched']) / len(cases), 3) if cases else 0
    }


def main():
    rows = load_dataset_rows()
    selected = select_diverse_conversations(rows, limit=25)
    model = pipeline(
        'text-classification',
        model='SamLowe/roberta-base-go_emotions',
        tokenizer='SamLowe/roberta-base-go_emotions',
        top_k=None,
        truncation=True,
        device=-1
    )

    cases = []
    for case in selected:
        outputs = model(case['messages'], batch_size=8)
        if isinstance(outputs, list) and outputs and isinstance(outputs[0], list):
            case_outputs = outputs
        else:
            case_outputs = [outputs]
        cases.append(build_case_record(case, case_outputs))

    summary = build_summary(cases)
    payload = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'model': 'SamLowe/roberta-base-go_emotions',
        'benchmarkPurpose': 'External benchmark for research evaluation only; not used for training the live classifier.',
        'totalCases': len(cases),
        'summary': summary,
        'cases': cases
    }

    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(json.dumps(payload, indent=2), encoding='utf-8')
    print(f'Wrote {len(cases)} benchmark cases to {RESULT_PATH}')
    print(json.dumps({
        'totalCases': len(cases),
        'model': 'SamLowe/roberta-base-go_emotions',
        'summary': summary
    }, indent=2))


if __name__ == '__main__':
    main()
