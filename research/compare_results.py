#!/usr/bin/env python3
"""
Compares three sources of handoff decisions for the study's 25 conversations:
general participants, customer-service professionals, and the precomputed AI
analysis. Does NOT treat any one source as ground truth - only reports
agreement/disagreement between each pair, plus per-conversation handoff rates.

Input files:
  --responses   JSON array exported from localStorage['study.responses.v1']
                (or a Supabase export in the same shape), each item shaped
                { participantId, role, conversationId, handoffDecision, optionalReason, ... }
  --ai-file     research/ai_analysis_25.json (default), each item shaped
                { conversationId, aiHandoffDecision, ... }

Usage:
  python research/compare_results.py --responses path/to/exported_responses.json
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def agreement_rate(pairs):
    if not pairs:
        return None
    agree = sum(1 for a, b in pairs if a == b)
    return round(agree / len(pairs), 3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--responses', required=True, help='Exported participant/professional responses JSON')
    parser.add_argument('--ai-file', default=str(ROOT / 'research' / 'ai_analysis_25.json'))
    parser.add_argument('--out', default=str(ROOT / 'research' / 'comparison_report.json'))
    args = parser.parse_args()

    responses = load_json(args.responses)
    ai_records = load_json(args.ai_file)
    ai_by_conv = {record['conversationId']: bool(record['aiHandoffDecision']) for record in ai_records}

    by_role_and_conv = defaultdict(lambda: defaultdict(list))
    reasons = []
    for response in responses:
        role = response.get('role', 'general')
        conv_id = response.get('conversationId')
        decision = bool(response.get('handoffDecision'))
        by_role_and_conv[role][conv_id].append(decision)
        if response.get('optionalReason'):
            reasons.append({
                'participantId': response.get('participantId'),
                'role': role,
                'conversationId': conv_id,
                'handoffDecision': decision,
                'reason': response['optionalReason']
            })

    general_by_conv = {conv_id: decisions for conv_id, decisions in by_role_and_conv.get('general', {}).items()}
    professional_by_conv = {conv_id: decisions for conv_id, decisions in by_role_and_conv.get('professional', {}).items()}

    def majority(decisions):
        if not decisions:
            return None
        return sum(decisions) > len(decisions) / 2

    per_conversation = {}
    for conv_id in ai_by_conv:
        general_decisions = general_by_conv.get(conv_id, [])
        professional_decisions = professional_by_conv.get(conv_id, [])
        per_conversation[conv_id] = {
            'aiHandoffDecision': ai_by_conv[conv_id],
            'generalHandoffRate': round(sum(general_decisions) / len(general_decisions), 3) if general_decisions else None,
            'professionalHandoffRate': round(sum(professional_decisions) / len(professional_decisions), 3) if professional_decisions else None,
            'generalResponseCount': len(general_decisions),
            'professionalResponseCount': len(professional_decisions)
        }

    participant_vs_ai_pairs = []
    professional_vs_ai_pairs = []
    participant_vs_professional_pairs = []
    disagreement_counts = defaultdict(int)

    for conv_id, ai_decision in ai_by_conv.items():
        for decision in general_by_conv.get(conv_id, []):
            participant_vs_ai_pairs.append((decision, ai_decision))
            if decision != ai_decision:
                disagreement_counts['general_vs_ai'] += 1
        for decision in professional_by_conv.get(conv_id, []):
            professional_vs_ai_pairs.append((decision, ai_decision))
            if decision != ai_decision:
                disagreement_counts['professional_vs_ai'] += 1

        general_majority = majority(general_by_conv.get(conv_id, []))
        professional_majority = majority(professional_by_conv.get(conv_id, []))
        if general_majority is not None and professional_majority is not None:
            participant_vs_professional_pairs.append((general_majority, professional_majority))
            if general_majority != professional_majority:
                disagreement_counts['general_majority_vs_professional_majority'] += 1

    report = {
        'totalConversations': len(ai_by_conv),
        'agreementRates': {
            'participantVsAi': agreement_rate(participant_vs_ai_pairs),
            'professionalVsAi': agreement_rate(professional_vs_ai_pairs),
            'participantMajorityVsProfessionalMajority': agreement_rate(participant_vs_professional_pairs)
        },
        'disagreementCounts': dict(disagreement_counts),
        'perConversation': per_conversation,
        'writtenExplanations': reasons
    }

    Path(args.out).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f'Wrote comparison report to {args.out}')
    print(json.dumps(report['agreementRates'], indent=2))


if __name__ == '__main__':
    main()
