# 현재 진행 상태 (백엔드 1 / 승현)

**마지막 업데이트:** 2026-05-03

> 다른 컴퓨터에서 작업 이어갈 때 이 파일부터 읽기. Claude에게 *"STATUS.md 읽고 다음 작업 도와줘"* 한 마디면 됨.

---

## ✅ 완료

### Day 1 — DB 스키마
- `seats` 테이블 status 컬럼 + holding_until로 마이그레이션
- `reservations` 테이블 생성 (RLS 활성화)
- 시드 데이터 30개 INSERT
- Realtime 활성화 (seats 테이블)
- `seats.reserved_by` dead column 제거

### Day 2 — 좌석 선점 + 동시성 검증
- `reserve_seat` RPC 함수 작성 (낙관적 락 + 트랜잭션 + SECURITY DEFINER)
- `app/page.tsx`에서 RPC 호출로 변경
- k6 부하테스트 500 VU → **1 성공 / 499 거절** (DB 직접 검증 완료)

### Day 3 — pg_cron 자동 만료
- pg_cron 익스텐션 활성화
- `expire_held_seats()` 함수 작성
- 매 1분 cron 등록 (`expire-held-seats`)
- 시간 강제 변경으로 동작 검증 완료

### Day 4 — 추가 RPC 함수
- `cancel_seat(p_seat_id, p_user_id)` — 선점 취소 + cancelled_at 기록
- `get_my_holds(p_user_id)` — 본인의 활성 HOLD 예약 조회

### Backend 2 — 인증/패널티/핀코드
- `lib/auth.ts` — Supabase Auth 래퍼 (`signUp`, `signIn`, `signOut`, `getCurrentUser`)
- `users` 테이블 — Auth 프로필 + 패널티 집계
- `penalties` 테이블 — 패널티 이력
- Auth 가입 트리거 — `auth.users` 생성 시 `public.users` 자동 생성
- `reserve_my_seat(p_seat_id)` — `auth.uid()` 기반 안전 예약 wrapper
- `cancel_my_seat(p_seat_id)` — `auth.uid()` 기반 안전 취소 wrapper
- `get_current_user_holds()` — 로그인 사용자 기준 활성 예약 조회
- `verify_pin(p_pin_code)` — 키오스크 핀코드 인증, `HOLD → OCCUPIED`
- 패널티 트리거 — `CANCELLED`/`EXPIRED` 전환 시 자동 패널티 계산
- 동일 유저 다중 좌석 선점 차단 — partial unique index 추가
- `app/page.tsx` — 임시 `TEST_USER_ID` 제거, 실제 Auth 세션 연결

### 문서
- `migrations/001~005.sql` — DB 변경 이력
- `SCHEMA.md` — 현재 DB 상태 (백 2 공유용)
- `DEV_NOTES.md` — 트러블슈팅 + k6 결과
- `CLAUDE.md` — Coaching Mode + Learning-First 추가
- `LEARNING.md`, `HOW_TO_LEARN.md` — 개인용 (gitignore)

---

## ⏳ 다음 작업

### Day 5 — 마무리
- Supabase SQL Editor에서 `migrations/009_backend2_auth_penalty_pin.sql` 적용
- 실제 Supabase 프로젝트에서 회원가입→로그인→예약→핀코드 인증→취소/만료 패널티 통합 테스트
- 프론트2와 키오스크 UI 흐름 최종 문구/에러 메시지 맞추기

---

## 환경 정보

| 항목 | 값 |
|------|---|
| Supabase 프로젝트 ID | `kmnviuihzsvturclzynm` |
| 리전 | ap-southeast-2 (Sydney) |
| 테스트 유저 UUID | `d714c83c-7fa2-4447-a2e4-b665fb1a5397` |
| 테스트 유저 이메일 | `test@test.com` |
| Supabase 무료 플랜 | 미사용 시 자동 일시정지 → Resume 필요 |

---

## 다른 컴퓨터 셋업 절차

```powershell
# 1. clone
git clone <레포 주소>
cd seat-reservation

# 2. 의존성
npm install

# 3. .env.local 만들기 (디스코드 DM 또는 1Password로 받은 내용)
#    NEXT_PUBLIC_SUPABASE_URL=...
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# 4. 작업 브랜치
git checkout -b feature/seunghyun-<작업명>

# 5. dev 서버
npm run dev
```

---

## 막힌 곳 / 진행 시 주의

- (없음)

---

## Git 브랜치 컨벤션

- `main` — 보호됨, 직접 푸시 X (브랜치 보호 룰 적용)
- `feature/<이름>-<기능>` — 작업 브랜치
- main 머지는 PR + 페어 리뷰 필요
