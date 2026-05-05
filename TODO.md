# 추후 개선 사항 (MVP 이후)

MVP 발표용 기능 구현엔 영향 없으나, 실서비스로 확장 시 고려할 항목들.

---

## 1. 만료 처리의 Gap Window 문제

**현재 상황:**
- `reserve_seat`의 WHERE 조건: `status = 'AVAILABLE'`
- cron은 1분마다 만료 좌석을 풀어줌
- 따라서 진짜 만료 시각(`holding_until`)과 cron 실행 사이에 **최대 1분의 gap**이 생김

**구체적 시나리오:**
```
t=10:10 진짜 만료 시각 (10분 경과)
t=10:10:30 다른 사용자가 화면에서 좌석 클릭
           → DB에는 status='HOLD'로 남아있음
           → reserve_seat 실패 ("이미 선점됨")
t=10:11 cron 실행 → 그제서야 AVAILABLE로 풀림
```

이 30초~1분 동안 좌석은 사실상 비었는데도 클릭이 거절됨.

**해결 방법: 진실의 원천을 시각으로 (production pattern)**

`reserve_seat`의 WHERE 조건을 시각 기반으로 확장:
```sql
WHERE id = p_seat_id
  AND (
    status = 'AVAILABLE'
    OR (status = 'HOLD' AND holding_until < NOW())  -- 만료된 HOLD도 새로 받음
  )
```

이렇게 하면 cron이 늦게 돌아도 RPC 자체가 즉시 정확한 판단을 함.

**추가로 좋은 패턴:**
- 좌석 조회 시 `CASE WHEN holding_until < NOW() THEN 'AVAILABLE' ELSE status END` 로 화면 표시
- 클라이언트 setInterval로 1초마다 만료 체크 → 화면 갱신

**우선순위:** 발표 전엔 무시 가능. 캡스톤 평가에서 "이 가능성을 인지하고 있다"고 답할 수 있으면 충분.

---

## 2. RLS 정책 (Day 5 예정이지만 메모)

**현재 상황:**
- `reservations` 테이블은 RLS 활성화돼 있지만 **정책 없음** → 외부 접근 모두 거절
- `reserve_seat`이 `SECURITY DEFINER`라 RPC를 통해서만 동작
- `seats` 테이블은 RLS 미활성화 (Supabase 보안 경고 중)

**필요한 정책:**
```sql
-- seats: 모두 SELECT 가능
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view seats" ON seats FOR SELECT TO anon, authenticated USING (true);

-- reservations: 본인 것만 SELECT
CREATE POLICY "Users can view own reservations" ON reservations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

---

## 3. 핀코드 충돌 가능성

**현재 상황:**
- 6자리 랜덤(000000~999999) → 1,000,000 경우의 수
- 동시 활성 예약 100개 정도면 충돌 확률 사실상 0

**잠재 문제:**
- 아주 드물게 같은 핀이 발급될 가능성 (생일 역설)
- 키오스크 인증 시 핀이 둘 이상 매치되면 문제

**해결 방법:**
- `reservations` 테이블에서 활성 예약(status=HOLD/OCCUPIED) 중 핀코드 UNIQUE 보장
- 함수에서 INSERT 실패 시 재발급 루프 (1~2회 재시도면 충분)

**우선순위:** 캡스톤 규모에선 불필요.

---

## 4. 동일 유저 다중 좌석 선점 차단

**백엔드 2의 Day 5 작업.** 한 유저가 여러 좌석을 동시에 선점하지 못하게 막는 로직. DB 제약 또는 함수에서 검증.

---

## 5. 부하/스케일

**현재:**
- 무료 플랜 커넥션 풀 ~60개
- k6 500 VU 시 평균 응답 8.9초 (대기열 발생)

**개선 방향:**
- Supabase Pro 플랜 → 커넥션 풀 확대
- 또는 리전 변경 (한국에서 ap-northeast-2 / 도쿄 가까운 곳)
- Realtime 기반 사전 차단 강화 (불필요한 RPC 호출 줄이기)

---

## 6. 모니터링/관측

**없음.** 발표 후 운영 단계에서:
- Supabase 대시보드의 쿼리 통계
- 에러 로그 수집 (Sentry 등)
- p95/p99 응답시간 추적

---

## 적용 순서 추천 (발표 후)

1. RLS 정책 (필수, 보안)
2. Gap Window 해결 (UX 영향 큼)
3. 다중 좌석 차단 (비즈니스 룰)
4. 핀코드 UNIQUE (확률은 낮지만 안전)
5. 부하/관측 (운영 단계)
