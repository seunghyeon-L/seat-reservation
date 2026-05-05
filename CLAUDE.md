**IMPORTANT: All rules in this file are absolute. Never ignore or violate them under any circumstances.**




# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
---

# 캡스톤 프로젝트 인수인계 문서

## 프로젝트 개요

**프로젝트명:** 학내 식당 좌석 선점 서비스

**주제:** 이동 시간이 긴 학생들이 강의실에서 미리 좌석을 선점하고, 식당 도착 후 키오스크에서 핀코드로 인증하여 자리를 확정하는 서비스

**팀:** 4명 (승현(나), 예훈, 혜영, 의림) -, 모두 컴공 3학년

**기간:** 2개월 캡스톤

**중요:** 팀원 4명 전부 기술 스택 거의 전무. React/Next.js/Supabase 처음 사용. 

---

## 핵심 서비스 로직

```
1. 학생이 앱에서 빈 좌석 클릭 → 10분간 선점 (HOLD 상태)
2. 핀코드 발급
3. 식당 도착 후 키오스크에서 핀코드 입력 → 예약 확정
4. 10분 안에 도착 못하면 자동 해제 + 패널티
```

**패널티 시스템:**
```
자발적 취소 0~5분: 패널티 없음
자발적 취소 5~10분: 패널티 1회
노쇼/자동만료: 패널티 2회
3회 누적 → 1주일 차단
```

**10분 선점 시간 근거:**
- 공대/의대 거점 기준 평균 도보 8분 + 준비 1분 + 키오스크 인증 1분
- 8~11분권 학생이 핵심 타겟 (3~5분권은 그냥 가면 됨, 15분 이상은 정문 상권으로 감)




## ERD (확정됨)

```
USERS
- id (uuid, PK)
- email
- name
- penalty_count (int) ← 추가됨
- is_blocked (boolean) ← 추가됨
- blocked_until (timestamp) ← 추가됨

SEATS
- id (uuid, PK)
- seat_number (UK)
- status (enum: AVAILABLE/HOLD/OCCUPIED)
- held_by (FK → users)
- holding_until (timestamp) ← 추가됨 (서버 꺼져도 자동 해제)

RESERVATIONS
- id (uuid, PK)
- seat_id (FK)
- user_id (FK)
- pin_code
- status (enum: PENDING/COMPLETED)
- payment_method
- start_time
- end_time
- cancelled_at (timestamp) ← 추가됨 (패널티 계산용)

PENALTIES (테이블 새로 추가됨)
- id (uuid, PK)
- user_id (FK)
- reservation_id (FK)
- reason (노쇼/늦은취소)
- created_at
```

---

## API 명세서 (확정됨, 노션에 작성 완료)

```
인증
POST   /auth/signup    회원가입
POST   /auth/login     로그인
POST   /auth/logout    로그아웃

좌석
GET    /seats              전체 좌석 조회
POST   /seats/:id/hold     좌석 선점
DELETE /seats/:id/hold     선점 취소

키오스크
POST   /seats/:id/confirm  핀코드 인증

패널티
GET    /users/:id/penalty  패널티 조회

상태코드: 200, 400, 401, 403, 410
```


---