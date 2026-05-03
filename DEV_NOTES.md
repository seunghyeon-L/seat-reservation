# 개발 노트 (백엔드 1)

작업하면서 만난 문제들과 설계 결정의 이유를 기록하는 문서.
새로운 결정이나 트러블슈팅이 생기면 여기에 계속 추가함.

---

## 설계 결정 (Design Decisions)

### 1. `is_reserved (boolean)` 대신 `status (TEXT)`

**문제:** 좌석 상태를 `true/false`로만 표현하면 부족함.

**이유:** 우리 서비스는 좌석 상태가 3가지 필요.
- `AVAILABLE` — 비어있음
- `HOLD` — 누군가 선점 중 (10분 타이머)
- `OCCUPIED` — 키오스크 인증까지 완료

`CHECK (status IN (...))` 제약으로 오타 방지.

---

### 2. `holding_until` 컬럼 추가

**문제:** 클라이언트의 타이머에만 의존하면 서버 꺼지면 좌석이 영원히 잠김.

**이유:** "이 좌석은 몇 시까지 HOLD 상태인지"를 DB에 저장.
- pg_cron이 `NOW() > holding_until`인 좌석을 자동으로 풀어줄 수 있음
- 진실의 원천(source of truth)은 서버 시각

---

### 3. `reservations` 테이블 분리

**문제:** 좌석 정보랑 예약 기록을 한 테이블에 넣으면 엉망이 됨.

**이유:** 역할 분리.
- `seats` — 현재 상태만 (AVAILABLE/HOLD/OCCUPIED)
- `reservations` — 예약 기록 (누가, 언제, 핀코드, 취소 시각 등)

패널티 계산, 키오스크 인증 등 부가 기능은 모두 `reservations`를 참조.

---

### 4. RPC 함수 (`reserve_seat`) 사용

**문제:** "좌석만 잠그면 끝"이 아님. 좌석 잠금 + 예약 기록 + 핀코드 생성을 한 번에 해야 함.

**이전 방식 (직접 UPDATE):**
```js
.update({ status: 'HOLD' }).eq('status', 'AVAILABLE')
```
- 단일 UPDATE는 PostgreSQL이 알아서 원자적으로 처리 → 동시성은 안전
- 하지만 다음 단계(reservations INSERT)가 실패하면 좌석은 잠긴 채로 좀비 상태가 됨

**RPC 방식:**
- 함수 안의 모든 SQL이 하나의 **트랜잭션**으로 묶임
- 전부 성공하거나 전부 실패 (중간 실패 시 자동 롤백)
- 핀코드 생성도 서버에서 → 클라이언트가 조작 불가

**결론:** 단순 1테이블 작업은 직접 UPDATE도 OK. 여러 테이블이 엮이면 RPC.

---

### 5. `REFERENCES auth.users(id)` 외래키

**문제:** 가짜 user_id로 예약 만들면 안 됨.

**이유:** DB에 외래키 제약을 걸어두면 존재하지 않는 유저는 INSERT 자체가 거절됨. 코드에서 검증할 필요 없이 DB가 자동으로 무결성 보장.

---

## 트러블슈팅 (Troubleshooting)

### 1. `TypeError: Failed to fetch`

**증상:** 앱 실행 시 좌석이 안 뜨고 fetch 에러.

**원인:** Supabase 무료 플랜은 일정 기간 미사용 시 프로젝트가 자동 일시정지됨.

**해결:** Supabase 대시보드에서 프로젝트 Resume 클릭.

---

### 2. `RLS Disabled in Public` 경고

**증상:** 테이블 만들 때 빨간 경고 띄움.

**원인:** RLS(Row Level Security)가 꺼져 있으면 anon 키만 알아도 누구나 데이터 접근 가능.

**해결:** "Run and enable RLS" 클릭. 정책(Policy)은 Day 5에 추가 예정.

> 개발 중에는 RLS 켜둬도 백엔드 직접 접근(SQL Editor)으론 문제없음. 클라이언트에서 막히면 그때 정책 추가.

---

### 3. `insert or update violates foreign key constraint "reservations_user_id_fkey"`

**증상:** RPC 함수 테스트 시 가짜 UUID로 호출하면 에러.

**원인:** `reservations.user_id`가 `auth.users(id)`를 FK로 참조. 존재하지 않는 유저 ID는 거절됨. (이 동작이 정상이고, 우리가 원하던 보안 동작.)

**해결:** Supabase 대시보드 → Authentication → Users → "Add user"로 진짜 테스트 유저 생성 후 그 UUID 사용.

---

### 4. `new row violates row-level security policy for table "reservations"` (코드 42501)

**증상:** 앱에서 좌석 클릭 시 RPC 함수가 실패. 브라우저 콘솔과 dev 서버 로그에 에러 출력.

**찾은 위치:** `npm run dev` 터미널에서 `[browser]` 접두사로 출력되는 클라이언트 에러. (Next.js 16 dev 서버가 브라우저 에러를 터미널에도 forwarding 해줌.)

**원인:** `reservations` 테이블 RLS는 켜뒀는데 정책(Policy)을 안 만들어둠. RLS가 켜져 있고 정책이 없으면 기본은 "전부 거절". RPC 함수 안의 INSERT도 호출자(anon)의 권한으로 실행되기 때문에 마찬가지로 거절됨.

**해결:** 함수 정의에 `SECURITY DEFINER` 추가 → 함수 작성자(슈퍼유저) 권한으로 실행돼서 RLS 우회.

```sql
CREATE OR REPLACE FUNCTION reserve_seat(...)
RETURNS JSON
SECURITY DEFINER       -- ★ 이 줄
AS $$
...
```

**왜 이게 안전한가:**
- 외부에서 reservations 테이블에 직접 INSERT는 여전히 RLS로 막혀있음
- 오직 우리가 검증한 reserve_seat 함수를 통해서만 INSERT 가능
- 함수 안의 로직이 단순하고 검증돼 있으므로 권한 상승 위험 없음

---

## k6 부하테스트 결과 (2026-05-03)

### 테스트 조건
- **시나리오:** 500명의 가상 유저(VU)가 1번 좌석을 동시에 예약 시도
- **DB 함수:** `reserve_seat(p_seat_id, p_user_id)` (낙관적 락 + 트랜잭션)
- **인프라:** Supabase 무료 플랜, ap-southeast-2 (Sydney), 한국에서 호출

### 결과
| 지표 | 값 |
|------|---|
| 총 요청 수 | 500 |
| HTTP 200 응답 | 500 (100%) |
| 예약 성공 | **1** |
| 예약 실패 (이미 선점됨) | **499** |
| 평균 응답시간 | 8.91s |
| p(95) 응답시간 | 9.28s |
| 처리량 | 52 req/s |

### DB 검증
- `seats` 테이블: 1번 좌석 1행만 `HOLD`, `holding_until` 정상 셋
- `reservations` 테이블: 1번 좌석에 대한 예약 기록 **정확히 1행**
- 핀코드: `898650` 1개만 발급

### 해석
- **동시성 처리 정상.** 500명 동시 요청 중 정확히 1명만 좌석 점유, 99.8%는 의도대로 거절
- 응답시간이 긴 이유는 무료 플랜 커넥션 풀(~60) 한계 때문. 실제 운영 시 동시 접속 50~100명 수준에선 응답시간 수십~수백 ms 수준 예상
- 이전 시도에서 겪었던 "모두 성공" 버그는 RPC의 `WHERE status = 'AVAILABLE'` 조건 덕분에 발생 불가

---

## 메모

- DB 단의 보호 장치(CHECK, FK, 트랜잭션)는 코드에서 빼먹어도 자동으로 작동함. 무결성을 코드에만 의존하면 위험.
- 한 번 짠 SQL은 사라지지 않음. `pg_constraint`, `pg_get_constraintdef()` 같은 시스템 카탈로그로 언제든 다시 조회 가능.
- k6 결과만 보지 말고 DB도 직접 조회해서 검증해야 함. 스크립트가 "성공"으로 카운트해도 실제 DB 상태가 다를 수 있음.
