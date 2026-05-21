-- 2026-05-21: 식사 후 체크아웃 기능
-- 작성자: 백엔드 1 (승현)
-- ★ 적용: Supabase SQL Editor에서 실행 (011 이후).
--
-- 흐름: OCCUPIED(식사 중) 좌석을 사용자가 체크아웃 →
--       예약 OCCUPIED→COMPLETED(+end_time), 좌석 OCCUPIED→AVAILABLE.
--       정상 종료라 패널티 없음. (패널티 트리거는 CANCELLED/EXPIRED만 반응)

-- ============================================
-- 1) reservations.status에 'COMPLETED' 추가
-- ============================================
-- 기존 CHECK 제약 이름이 환경마다 다를 수 있어 동적으로 찾아 교체.
DO $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.reservations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reservations DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('HOLD', 'OCCUPIED', 'CANCELLED', 'EXPIRED', 'COMPLETED'));

-- ============================================
-- 2) 식사 종료(체크아웃) 시각 컬럼
-- ============================================
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;

-- ============================================
-- 3) checkout_my_seat: 본인의 OCCUPIED 좌석 체크아웃
-- ============================================
CREATE OR REPLACE FUNCTION public.checkout_my_seat(p_seat_id BIGINT)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_updated INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', '로그인이 필요합니다');
  END IF;

  -- 본인의 OCCUPIED 예약을 COMPLETED로 (소유권 검증 + 상태 변경 동시)
  UPDATE public.reservations
  SET status = 'COMPLETED',
      end_time = NOW()
  WHERE seat_id = p_seat_id
    AND user_id = v_user_id
    AND status = 'OCCUPIED';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN json_build_object('success', false, 'message', '체크아웃할 좌석이 없습니다');
  END IF;

  -- 좌석 해제
  UPDATE public.seats
  SET status = 'AVAILABLE',
      holding_until = NULL
  WHERE id = p_seat_id;

  RETURN json_build_object('success', true, 'message', '체크아웃되었습니다');
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4) get_current_user_occupied: 본인의 현재 OCCUPIED(식사 중) 좌석 목록
-- ============================================
-- 프론트가 "체크아웃 버튼"을 띄울 좌석을 알기 위함.
CREATE OR REPLACE FUNCTION public.get_current_user_occupied()
RETURNS TABLE (
  reservation_id BIGINT,
  seat_id BIGINT,
  seat_number INTEGER,
  start_time TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.id, r.seat_id, s.seat_number, r.start_time
  FROM public.reservations r
  JOIN public.seats s ON r.seat_id = s.id
  WHERE r.user_id = v_user_id
    AND r.status = 'OCCUPIED';
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.checkout_my_seat(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_user_occupied() TO authenticated;
