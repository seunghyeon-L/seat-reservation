# DB 스키마 현재 상태

**최종 업데이트:** 2026-05-03 (백엔드 1 / 승현)

이 문서는 현재 Supabase DB의 스키마 스냅샷이에요. 변경 이력은 `migrations/` 폴더 참조.

---

## 테이블 목록

| 테이블 | 소유자 | 용도 |
|-------|-------|------|
| `seats` | 백엔드 1 | 좌석 현재 상태 |
| `reservations` | 백엔드 1 | 예약 기록 (이력) |
| `auth.users` | Supabase 내장 | 인증 유저 (수정 금지) |

---

## seats

좌석의 현재 상태만 저장. 30개 행이 시드돼 있음.

| 컬럼 | 타입 | NULL? | 기본값 | 설명 |
|------|------|-------|--------|------|
| `id` | BIGINT | NO | (자동증가) | PK |
| `seat_number` | INTEGER | NO | - | 좌석 번호 (1~30, UNIQUE) |
| `status` | TEXT | NO | `'AVAILABLE'` | `AVAILABLE` / `HOLD` / `OCCUPIED` (CHECK 제약) |
| `holding_until` | TIMESTAMPTZ | YES | NULL | HOLD 시 만료 시각 (NOW + 10분) |

### 제약 조건
- `CHECK (status IN ('AVAILABLE', 'HOLD', 'OCCUPIED'))`
- `UNIQUE (seat_number)`

### RLS
- ⚠️ **현재 비활성화.** Supabase 보안 경고 발생 중. Day 5에 정책 추가 예정.

---

## reservations

예약 기록. 한 좌석에 대해 여러 예약 행이 시간순으로 누적됨 (생성/취소/만료/확정 모두 기록).

| 컬럼 | 타입 | NULL? | 기본값 | 설명 |
|------|------|-------|--------|------|
| `id` | BIGINT | NO | (자동증가) | PK |
| `seat_id` | BIGINT | YES | NULL | FK → `seats(id)` |
| `user_id` | UUID | YES | NULL | FK → `auth.users(id)` |
| `pin_code` | TEXT | NO | - | 6자리 핀코드 (키오스크 인증용) |
| `status` | TEXT | NO | `'HOLD'` | `HOLD` / `OCCUPIED` / `CANCELLED` / `EXPIRED` (CHECK) |
| `holding_until` | TIMESTAMPTZ | NO | - | 선점 만료 시각 |
| `start_time` | TIMESTAMPTZ | YES | NULL | OCCUPIED 시 셋 (키오스크 인증 시각) |
| `cancelled_at` | TIMESTAMPTZ | YES | NULL | CANCELLED 시 셋 (패널티 계산용) |
| `created_at` | TIMESTAMPTZ | YES | `NOW()` | 예약 생성 시각 |

### 제약 조건
- `CHECK (status IN ('HOLD', 'OCCUPIED', 'CANCELLED', 'EXPIRED'))`
- `FK seat_id → seats(id)`
- `FK user_id → auth.users(id)`

### RLS
- ✅ **활성화됨.** 현재 정책 없음 → 모든 외부 접근 거절. RPC 함수의 `SECURITY DEFINER`로만 INSERT 가능.

---

## 함수 (Functions)

### `reserve_seat(p_seat_id BIGINT, p_user_id UUID) → JSON`

좌석 선점 RPC. 동시성 안전.

**동작:**
1. 6자리 핀코드 생성
2. 해당 좌석이 `AVAILABLE`이면 → `HOLD`로 변경 + `holding_until` = 10분 후
3. `reservations`에 새 예약 기록 INSERT
4. 1~3은 한 트랜잭션 (모두 성공 또는 모두 실패)

**반환:**
- 성공: `{ "success": true, "pin_code": "123456" }`
- 실패: `{ "success": false, "message": "이미 선점된 좌석입니다" }`

**보안 모드:** `SECURITY DEFINER` (RLS 우회).

---

### `expire_held_seats() → void`

만료된 좌석/예약 자동 정리. pg_cron이 1분마다 자동 호출.

**동작:**
1. `reservations`: `status='HOLD' AND holding_until < NOW()` → `EXPIRED`
2. `seats`: `status='HOLD' AND holding_until < NOW()` → `AVAILABLE`, `holding_until=NULL`

**호출 주체:** pg_cron 작업 `expire-held-seats` (매 1분)

**보안 모드:** `SECURITY DEFINER`

---

### `cancel_seat(p_seat_id BIGINT, p_user_id UUID) → JSON`

본인의 활성 HOLD 예약 취소.

**동작:**
1. `reservations`: 본인의 HOLD → `CANCELLED`, `cancelled_at = NOW()`
2. 0행 변경이면 → 실패 응답 (본인 예약 없음)
3. 성공 시 → `seats`: `AVAILABLE`, `holding_until = NULL`

**반환:**
- 성공: `{ "success": true }`
- 실패: `{ "success": false, "message": "취소할 예약이 없습니다" }`

**보안 모드:** `SECURITY DEFINER`. WHERE의 `user_id = p_user_id`로 남의 예약 취소 불가.

---

### `get_my_holds(p_user_id UUID) → TABLE`

본인의 활성 HOLD 예약 목록 조회.

**반환 컬럼:** `reservation_id, seat_id, seat_number, pin_code, holding_until`

**호출 예:** `SELECT * FROM get_my_holds('<uuid>');`

**보안 모드:** `SECURITY DEFINER` (RLS 우회).

---

## pg_cron 작업

| 이름 | 주기 | 실행 SQL |
|------|------|---------|
| `expire-held-seats` | `* * * * *` (매 1분) | `SELECT expire_held_seats();` |

작업 목록 확인: `SELECT * FROM cron.job;`

---

## 백엔드 2 협업 가이드

### 자유롭게 추가해도 OK
- 새 함수 (`verify_pin`, `apply_penalty` 등)
- 새 테이블 (`penalties` 등)
- 자기 소유 테이블에 새 컬럼 추가

### 의논 필요
- `seats`/`reservations` 데이터 변경 (예: HOLD → OCCUPIED 전환 시 `start_time` 셋 컨벤션)

### 절대 금지 (사전 합의 없이)
- `seats`/`reservations` 컬럼 변경/삭제
- `reserve_seat` 함수 수정/삭제
- CHECK 제약 변경

---

## 갱신 방법

스키마가 바뀌면 이 파일도 함께 업데이트. 자동 추출은 다음 SQL로:

```sql
-- 모든 테이블 + 컬럼
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- 모든 함수
SELECT proname, pg_get_functiondef(oid)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace;

-- 모든 제약 조건
SELECT conrelid::regclass AS 테이블, conname AS 제약명, pg_get_constraintdef(oid) AS 정의
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace;
```
