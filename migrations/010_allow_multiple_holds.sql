-- 2026-05-20: 1인 다중 좌석 선점 허용 (최대 4개)
-- 작성자: 백엔드 1 (승현)
-- 배경: 기존엔 1인 1좌석만 허용했으나, 일행 좌석 동시 선점을 위해 1인 최대 4개까지 허용.
--
-- ★ 적용: Supabase SQL Editor에서 이 파일을 직접 실행해야 반영됨.
--   (마이그레이션 파일은 코드일 뿐, 자동 적용되지 않음 — 009 적용했던 것과 동일하게)

-- ============================================
-- 1) "1인 1활성 HOLD"를 강제하던 unique index 제거
-- ============================================
-- 이 인덱스가 있으면 두 번째 HOLD INSERT가 unique 위반으로 막힘.
DROP INDEX IF EXISTS public.reservations_one_active_hold_per_user_idx;

-- ============================================
-- 2) reserve_my_seat: "이미 선점 중이면 거절" → "활성 HOLD 4개 이상이면 거절"
-- ============================================
-- 변경점:
--   - 기존: 활성 HOLD가 1개라도 있으면 거절
--   - 변경: 활성 HOLD 개수를 세서 4개 이상일 때만 거절
--   - 동시 클릭 레이스 방지: 본인 users 행을 FOR UPDATE로 잠가
--     같은 유저의 동시 예약 요청을 직렬화 → 4개 한도를 정확히 보장.
CREATE OR REPLACE FUNCTION public.reserve_my_seat(p_seat_id BIGINT)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile public.users%ROWTYPE;
  v_active_hold_count INTEGER;
  v_result JSON;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', '로그인이 필요합니다');
  END IF;

  PERFORM public.ensure_user_profile(v_user_id);

  -- cron 지연으로 남아있는 본인의 만료 HOLD 즉시 정리.
  UPDATE public.reservations
  SET status = 'EXPIRED'
  WHERE user_id = v_user_id
    AND status = 'HOLD'
    AND holding_until < NOW();

  UPDATE public.seats s
  SET status = 'AVAILABLE',
      holding_until = NULL
  WHERE s.status = 'HOLD'
    AND NOT EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.seat_id = s.id
        AND r.status = 'HOLD'
        AND r.holding_until > NOW()
    );

  -- 본인 프로필 행을 잠근다(FOR UPDATE) → 같은 유저의 동시 예약 요청 직렬화.
  SELECT *
  INTO v_profile
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_profile.is_blocked AND v_profile.blocked_until IS NOT NULL AND v_profile.blocked_until > NOW() THEN
    RETURN json_build_object(
      'success', false,
      'message', '패널티로 예약이 제한된 상태입니다',
      'blocked_until', v_profile.blocked_until
    );
  END IF;

  IF v_profile.is_blocked AND (v_profile.blocked_until IS NULL OR v_profile.blocked_until <= NOW()) THEN
    UPDATE public.users
    SET is_blocked = FALSE,
        blocked_until = NULL,
        updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  -- 활성 HOLD 개수 확인 (1인 최대 4개)
  SELECT COUNT(*)
  INTO v_active_hold_count
  FROM public.reservations
  WHERE user_id = v_user_id
    AND status = 'HOLD'
    AND holding_until > NOW();

  IF v_active_hold_count >= 4 THEN
    RETURN json_build_object('success', false, 'message', '최대 4개까지 선점할 수 있습니다');
  END IF;

  v_result := public.reserve_seat(p_seat_id, v_user_id);
  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    -- 1인 1좌석 인덱스는 제거됨. 여기 걸리면 핀코드 충돌(매우 드묾) 정도.
    RETURN json_build_object('success', false, 'message', '예약 처리 중 충돌이 발생했습니다. 다시 시도해주세요');
END;
$$ LANGUAGE plpgsql;
