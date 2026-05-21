-- 2026-05-21: 핀코드 라이프사이클 정리 + 발급 충돌 시 자동 재발급
-- 작성자: 백엔드 1 (승현)
-- ★ 적용: Supabase SQL Editor에서 실행 (010 적용 후).

-- ============================================
-- 1) pin_code를 HOLD 종료 시 비울 수 있도록 NOT NULL 해제
-- ============================================
-- HOLD일 때만 핀이 값이 있고, 끝나면 NULL로 비우는 게 목표.
ALTER TABLE public.reservations ALTER COLUMN pin_code DROP NOT NULL;

-- ============================================
-- 2) HOLD가 아니게 되면 pin_code 자동 제거 (트리거)
-- ============================================
-- 사용(OCCUPIED)·만료(EXPIRED)·취소(CANCELLED) 어느 경우든 핀이 사라짐.
-- 기존 함수들(verify_pin / expire_held_seats / cancel_seat / reserve_my_seat 정리)은
-- 전부 status를 바꾸는 UPDATE라, 이 트리거 하나가 한 곳에서 처리 → 함수들 손 안 댐.
CREATE OR REPLACE FUNCTION public.clear_pin_when_not_held()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'HOLD' THEN
    NEW.pin_code := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_pin_on_status_change ON public.reservations;
CREATE TRIGGER clear_pin_on_status_change
BEFORE UPDATE OF status ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.clear_pin_when_not_held();

-- ============================================
-- 3) reserve_seat: 핀 충돌 시 자동 재발급 (최대 5회)
-- ============================================
-- 충돌 검사는 활성 HOLD 핀 unique index가 INSERT 시점에 잡아줌 → O(log n), 사실상 즉시.
-- 별도 비교 루프 없음. 겹치면 새 핀으로 재시도. (좌석 UPDATE는 루프 밖이라 유지됨)
CREATE OR REPLACE FUNCTION reserve_seat(p_seat_id BIGINT, p_user_id UUID)
RETURNS JSON
SECURITY DEFINER
AS $$
DECLARE
  v_updated INT;
  v_pin TEXT;
BEGIN
  -- AVAILABLE 좌석만 HOLD로 (낙관적 락)
  UPDATE seats
  SET status = 'HOLD',
      holding_until = NOW() + INTERVAL '10 minutes'
  WHERE id = p_seat_id AND status = 'AVAILABLE';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN json_build_object('success', false, 'message', '이미 선점된 좌석입니다');
  END IF;

  -- 핀 발급: 겹치면 새 핀으로 재시도 (최대 5회)
  FOR i IN 1..5 LOOP
    BEGIN
      v_pin := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
      INSERT INTO reservations (seat_id, user_id, pin_code, holding_until)
      VALUES (p_seat_id, p_user_id, v_pin, NOW() + INTERVAL '10 minutes');
      RETURN json_build_object('success', true, 'pin_code', v_pin);
    EXCEPTION WHEN unique_violation THEN
      -- 핀 충돌 → 루프 돌아 새 핀 시도
    END;
  END LOOP;

  -- 5회 모두 충돌(확률상 사실상 불가능) → 예외로 전체 롤백(좌석도 AVAILABLE 복구)
  RAISE EXCEPTION '핀코드 발급에 반복 실패했습니다' USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql;
