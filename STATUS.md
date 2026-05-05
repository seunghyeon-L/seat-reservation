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

### 문서
- `migrations/001~005.sql` — DB 변경 이력
- `SCHEMA.md` — 현재 DB 상태 (백 2 공유용)
- `DEV_NOTES.md` — 트러블슈팅 + k6 결과
- `CLAUDE.md` — Coaching Mode + Learning-First 추가
- `LEARNING.md`, `HOW_TO_LEARN.md` — 개인용 (gitignore)

---

## ⏳ 다음 작업

### Day 3 — pg_cron 자동 만료
- `holding_until < NOW()`인 HOLD 좌석을 1분마다 자동으로 AVAILABLE로 풀기
- pg_cron 익스텐션 활성화 + 스케줄 설정
- 시간 조작해서 cron 동작 검증

### Day 4 — 추가 API
- 좌석 조회 API (내가 hold 중인 것만)
- 선점 취소 API (`cancelled_at` 기록)

### Day 5 — 마무리
- 노쇼 시나리오 통합 테스트
- RLS 정책 추가 (남의 예약 못 보게)

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
