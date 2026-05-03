-- 2026-05-03: 좌석 선점 RPC 함수 (낙관적 락 + 트랜잭션)
-- 작성자: 백엔드 1 (승현)
-- 목적: 동시성 안전한 좌석 선점. 좌석 잠금 + 예약 기록 INSERT + 핀코드 발급을 한 트랜잭션으로 처리.
--
-- 호출 예: SELECT reserve_seat(1, '<user_uuid>');
-- 응답: { "success": true, "pin_code": "123456" } 또는 { "success": false, "message": "..." }
--
-- SECURITY DEFINER:
--   함수 작성자(슈퍼유저) 권한으로 실행 → reservations 테이블의 RLS 우회.
--   외부에서 직접 INSERT는 RLS로 막혀있고, 검증된 이 함수를 통해서만 INSERT 가능.

CREATE OR REPLACE FUNCTION reserve_seat(p_seat_id BIGINT, p_user_id UUID)
RETURNS JSON
SECURITY DEFINER
AS $$
DECLARE
  v_updated INT;
  v_pin TEXT;
BEGIN
  -- 6자리 핀코드 생성 (000000~999999)
  v_pin := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

  -- AVAILABLE 좌석만 HOLD로 변경 (낙관적 락)
  UPDATE seats
  SET status = 'HOLD',
      holding_until = NOW() + INTERVAL '10 minutes'
  WHERE id = p_seat_id AND status = 'AVAILABLE';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 0행 영향 = 이미 누군가 선점함
  IF v_updated = 0 THEN
    RETURN json_build_object('success', false, 'message', '이미 선점된 좌석입니다');
  END IF;

  -- 예약 기록 저장 (트랜잭션이라 위 UPDATE가 실패하면 여기까지 안 옴)
  INSERT INTO reservations (seat_id, user_id, pin_code, holding_until)
  VALUES (p_seat_id, p_user_id, v_pin, NOW() + INTERVAL '10 minutes');

  RETURN json_build_object('success', true, 'pin_code', v_pin);
END;
$$ LANGUAGE plpgsql;
