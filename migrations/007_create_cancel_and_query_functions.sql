-- 2026-05-03: Day 4 — 좌석 조회 + 선점 취소 RPC
-- 작성자: 백엔드 1 (승현)

-- ============================================
-- 1) cancel_seat: 본인의 활성 HOLD 예약을 취소
-- ============================================
-- 동작:
--   1. reservations에서 본인의 HOLD 예약을 CANCELLED로 변경 (cancelled_at 셋)
--   2. 위가 성공한 경우에만 seats를 AVAILABLE로 풀어줌
--   3. 두 UPDATE는 한 트랜잭션 (둘 다 성공 또는 둘 다 롤백)
--
-- 보안: WHERE에 user_id 검증이 들어가서 남의 예약은 못 취소함

CREATE OR REPLACE FUNCTION cancel_seat(p_seat_id BIGINT, p_user_id UUID)
RETURNS JSON
SECURITY DEFINER
AS $$
DECLARE
  v_updated INT;
BEGIN
  -- 1) 본인의 HOLD 예약을 CANCELLED로 (소유권 검증 + 상태 변경 동시 수행)
  UPDATE reservations
  SET status = 'CANCELLED',
      cancelled_at = NOW()
  WHERE seat_id = p_seat_id
    AND user_id = p_user_id
    AND status = 'HOLD';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 0행이면 → 본인의 HOLD 예약이 없음 (이미 취소됐거나, 남의 예약이거나)
  IF v_updated = 0 THEN
    RETURN json_build_object('success', false, 'message', '취소할 예약이 없습니다');
  END IF;

  -- 2) 좌석을 AVAILABLE로 풀어줌 (NULL은 따옴표 없이 진짜 null 값)
  UPDATE seats
  SET status = 'AVAILABLE',
      holding_until = NULL
  WHERE id = p_seat_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;


-- ============================================
-- 2) get_my_holds: 내가 hold 중인 예약 목록
-- ============================================
-- 동작:
--   reservations와 seats를 JOIN해서 본인의 HOLD 예약만 반환.
--   RLS가 켜진 reservations를 SECURITY DEFINER로 우회.
--
-- 호출 예: SELECT * FROM get_my_holds('<user_uuid>');

CREATE OR REPLACE FUNCTION get_my_holds(p_user_id UUID)
RETURNS TABLE (
  reservation_id BIGINT,
  seat_id BIGINT,
  seat_number INTEGER,
  pin_code TEXT,
  holding_until TIMESTAMPTZ
)
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.seat_id,
    s.seat_number,
    r.pin_code,
    r.holding_until
  FROM reservations r
  JOIN seats s ON r.seat_id = s.id
  WHERE r.user_id = p_user_id
    AND r.status = 'HOLD';
END;
$$ LANGUAGE plpgsql;
