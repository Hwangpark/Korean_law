# Review Checklist · orch-006

- Generated at: 2026-04-17T01:40:02.914Z
- Task: Add reviewer checklist automation
- Status: completed
- Owner role: orchestrator

## Files in scope
- scripts/orchestrator/review-checklist.ts
- docs/review-notes.md
- package.json
- ops/tasks.json

## Review focus
- 법률 정확성 표현이 과도하지 않은지 확인
- privacy / disclaimer / guest quota 규칙이 유지되는지 확인
- retrieval evidence 부족 상태에서 강한 결론을 내리지 않는지 확인
- 파일 경계 위반이나 스파게티 결합이 생기지 않았는지 확인

## Validation commands
- npm run orch:review -- --task orch-006
- npm run orch:review -- --task orch-006 --write
- npm run orch:validate
- npm run typecheck

## Reviewer guardrails
- Do not touch apps/api/src/**
- Do not touch apps/web/**
- Do not touch fixtures/**
- Do not touch main.
- Do not commit .claude/, .env.local, or secrets unless explicitly requested.
- One agent owns one file at a time.
- Runtime stage names stay ocr, classifier, law, precedent, analysis, orchestrator.
- MCP-first retrieval logic stays in retrieval runtime, not in law/precedent agents.
- Do not remove privacy masking, guest quota, or disclaimer rules.
- Stop after three repeated failures on the same error and report a new plan.

## Findings
- Result: pending review
- Notes:
  - 
