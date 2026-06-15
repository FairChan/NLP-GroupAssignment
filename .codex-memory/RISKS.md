# Risks

## Active Risks

### Memory files may become stale

Owner: team
Severity: medium
Status: open

Description:
- Codex may continue from old chat context if users skip the opening protocol.

Mitigation:
- Require every new or resumed thread to run memory sync before editing.
