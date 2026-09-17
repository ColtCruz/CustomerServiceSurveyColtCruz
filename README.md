# Customer Service Conversation Review Study

This repository contains a web-based research study evaluating when customer-service conversations should be transferred to a human customer-service representative.

The project is being developed as part of Human-Computer Interaction research at Full Sail University.

## Study Purpose

The purpose of this study is to examine how people evaluate customer-service conversations and decide when human intervention is appropriate.

Participants review a fixed set of 25 customer-service conversations selected from an external customer-service dataset.

For each conversation, participants decide whether the interaction should be transferred to a human customer-service representative and may optionally explain the reason for their decision.

A customer-service professional will also review the same 25 conversations so professional judgments can be compared with participant responses and the automated handoff system.

## Study Flow

The participant experience follows this sequence:

1. Consent
2. Study instructions
3. Review of 25 customer-service conversations
4. Handoff decision for each conversation
5. Optional explanation for each decision
6. Post-study survey
7. Study completion

All participants evaluate the same underlying 25 conversations. The presentation order may be randomized.

## Participant Groups

The study may include:

* General participants
* Customer-service professionals

Professional reviewers may also provide information about their customer-service background, including job role, years of experience, industry, and experience making escalation or handoff decisions.

## Data Collected

The study may collect:

* Anonymous participant ID
* Participant type
* Conversation ID
* Handoff decision
* Optional explanation
* Post-study survey responses
* Professional qualification information
* Study completion status
* Submission timestamps
* Limited technical information used to reduce duplicate submissions

## Duplicate Submission Protection

The study is designed to reduce repeated submissions from the same participant.

A secure server-side process may read a participant's network IP address and convert it into a one-way hashed value.

The raw IP address should not be stored in the research database unless specifically required by the approved research protocol.

The hashed value may be used together with:

* Anonymous participant ID
* Browser completion information
* Study completion records

to help identify likely duplicate submissions.

IP-based duplicate detection is not considered a perfect identity check because multiple people may share the same network address and individual addresses may change.

## Research Data Structure

The fixed study conversations are stored separately from participant response data.

The intended structure includes:

```text
research/
├── study_conversations.json
└── ai_analysis_25.json
```

`study_conversations.json` contains the fixed set of 25 customer-service conversations used in the study.

`ai_analysis_25.json` contains the automated analysis of those same conversations for researcher-side comparison.

Participant responses are stored separately in the study database.

## Data Storage

The deployed study is intended to use Supabase as the centralized research database.

The primary data structure may include:

```text
participant_responses
post_study_surveys
reviewer_qualifications
study_completions
```

### participant_responses

Stores each participant's decision for each conversation.

Examples of stored information include:

* participant ID
* participant role
* conversation ID
* handoff decision
* optional explanation
* timestamp

### post_study_surveys

Stores participant responses to the questionnaire completed after the 25 conversation reviews.

### reviewer_qualifications

Stores professional background information for customer-service reviewers.

### study_completions

Stores completion information such as:

* participant ID
* participant role
* completion status
* number of conversations reviewed
* survey completion status
* completion timestamp
* hashed duplicate-detection identifier, when enabled

## Researcher Dashboard

A separate researcher dashboard is intended to provide access to the collected study data.

The dashboard may display:

* Number of completed participants
* Number of completed professional reviewers
* Conversation-level handoff decisions
* Optional written explanations
* Post-study survey responses
* Professional reviewer qualifications
* Automated handoff decisions
* General participant handoff rates
* Professional reviewer handoff rates
* Human-to-system agreement measures
* Study completion status

The researcher dashboard is not part of the participant-facing study experience.

## Automated Analysis

The research project includes a separate automated analysis of the same 25 conversations.

The automated system may evaluate signals including:

* Sentiment
* Emotion
* Frustration
* Anger
* Urgency
* Confusion
* Escalation risk
* Explicit requests for human assistance

The automated results are kept separate from the participant decision-making interface so participants are not influenced by the automated system's judgment.

## Technology

The project may use:

* HTML
* CSS
* JavaScript
* JSON
* Python
* Hugging Face Transformers
* GoEmotions
* GitHub Pages
* Supabase

GitHub Pages hosts the participant-facing study interface.

Supabase provides centralized storage for study responses and completion records.

Server-side or serverless functionality may be used for duplicate-submission checks and other operations that should not be performed entirely in the participant's browser.

## Privacy and Research Integrity

The study is designed to limit the collection of personally identifying information.

Technical information used for duplicate-submission detection should be minimized and protected.

Raw IP addresses, private database credentials, service-role keys, passwords, and other sensitive information must not be committed to this public repository.

Only public frontend configuration intended for browser use should be included in client-side files.

Any participant-facing consent language should accurately describe the information collected during the approved study.

## Repository Security

Do not commit:

* Supabase service-role keys
* Private API keys
* Passwords
* Database administrator credentials
* Raw participant exports
* Raw IP address records
* Personally identifying participant information

Sensitive research data should remain in the approved research database or other authorized storage location.

## Research Status

This project is currently under development as part of an academic research study.

The study interface, dataset selection, database structure, duplicate-submission protection, automated analysis, and researcher dashboard may continue to change during development and validation.

## Author

Colt Cruz
Human-Computer Interaction
Full Sail University
