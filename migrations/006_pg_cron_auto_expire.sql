-- 2026-05-03: pg_cron으로 만료 좌석 자동 해제
-- 작성자: 백엔드 1 (승현)
-- 목적: HOLD 상태이면서 holding_until이 지난 좌석/예약을 1분마다 자동 정리.
--
-- 사전 작업: Supabase 대시보드 → Database → Extensions에서 pg_cron Enable
-- (이 SQL은 Enable 이후에만 동작함)

-- 1) 만료 처리 함수
CREATE OR REPLACE FUNCTION expire_held_seats()
RETURNS void
SECURITY DEFINER
AS $$
BEGIN
  -- reservations: HOLD 중 만료된 것 → EXPIRED
  UPDATE reservations
  SET status = 'EXPIRED'
  WHERE status = 'HOLD' AND holding_until < NOW();

  -- seats: HOLD 중 만료된 것 → AVAILABLE
  UPDATE seats
  SET status = 'AVAILABLE', holding_until = NULL
  WHERE status = 'HOLD' AND holding_until < NOW();
END;
$$ LANGUAGE plpgsql;

-- 2) 1분마다 위 함수 호출하도록 cron 등록
SELECT cron.schedule(
  'expire-held-seats',                    -- 작업 이름 (식별자)
  '* * * * *',                             -- 매 1분
  $$ SELECT expire_held_seats(); $$        -- 실행할 SQL
);
