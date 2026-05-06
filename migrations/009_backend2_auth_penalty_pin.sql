-- 2026-05-06: Backend 2 — Auth profile, penalties, pin verification, and user-safe RPC wrappers
-- 담당: 백엔드 2
--
-- 기존 백엔드 1 함수(reserve_seat/cancel_seat/get_my_holds)는 유지한다.
-- 클라이언트는 이 파일에서 추가한 auth.uid() 기반 wrapper RPC를 호출해서
-- p_user_id 스푸핑과 다중 선점을 막는다.

-- ============================================
-- 1) 사용자 프로필 + 패널티 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  student_id TEXT UNIQUE,
  penalty_count INTEGER NOT NULL DEFAULT 0 CHECK (penalty_count >= 0),
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.penalties (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reservation_id BIGINT UNIQUE REFERENCES public.reservations(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('LATE_CANCEL', 'NO_SHOW')),
  points INTEGER NOT NULL CHECK (points IN (1, 2)),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS penalties_user_created_idx
  ON public.penalties (user_id, created_at DESC);

-- 기존 테스트 데이터 정리: 이미 만료된 HOLD는 먼저 EXPIRED 처리.
UPDATE public.reservations
SET status = 'EXPIRED'
WHERE status = 'HOLD'
  AND holding_until < NOW();

UPDATE public.seats
SET status = 'AVAILABLE',
    holding_until = NULL
WHERE status = 'HOLD'
  AND holding_until < NOW();

-- 기존 테스트 데이터 정리: 한 유저의 활성 HOLD가 여러 개면 최신 1개만 유지.
WITH ranked_holds AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
  FROM public.reservations
  WHERE status = 'HOLD'
    AND holding_until > NOW()
)
UPDATE public.reservations
SET status = 'EXPIRED'
WHERE id IN (SELECT id FROM ranked_holds WHERE rn > 1);

-- 기존 테스트 데이터 정리: 활성 HOLD 핀코드가 중복이면 최신 1개만 유지.
WITH ranked_pins AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY pin_code ORDER BY created_at DESC, id DESC) AS rn
  FROM public.reservations
  WHERE status = 'HOLD'
    AND holding_until > NOW()
)
UPDATE public.reservations
SET status = 'EXPIRED'
WHERE id IN (SELECT id FROM ranked_pins WHERE rn > 1);

-- 중복 정리로 활성 HOLD 예약이 사라진 좌석은 AVAILABLE로 맞춘다.
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

-- 한 유저가 동시에 HOLD 예약을 여러 개 만들지 못하게 DB 레벨에서 차단.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_hold_per_user_idx
  ON public.reservations (user_id)
  WHERE status = 'HOLD';

-- 키오스크 핀코드 모호성을 줄이기 위해 활성 HOLD 핀코드 중복 방지.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_active_hold_pin_code_idx
  ON public.reservations (pin_code)
  WHERE status = 'HOLD';

-- ============================================
-- 2) Auth 가입 시 public.users 자동 생성
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, student_id)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(NEW.raw_user_meta_data->>'student_id', '')
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, public.users.name),
      student_id = COALESCE(EXCLUDED.student_id, public.users.student_id),
      updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user();

-- ============================================
-- 3) RLS 정책
-- ============================================

ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.penalties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view seats" ON public.seats;
CREATE POLICY "Anyone can view seats"
  ON public.seats
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can view own reservations" ON public.reservations;
CREATE POLICY "Users can view own reservations"
  ON public.reservations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
CREATE POLICY "Users can view own profile"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile"
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can view own penalties" ON public.penalties;
CREATE POLICY "Users can view own penalties"
  ON public.penalties
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================
-- 4) 내부 유틸 함수
-- ============================================

CREATE OR REPLACE FUNCTION public.ensure_user_profile(p_user_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  SELECT au.id, au.email
  FROM auth.users au
  WHERE au.id = p_user_id
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.apply_penalty_for_reservation(p_reservation_id BIGINT)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_reason TEXT;
  v_points INTEGER := 0;
  v_inserted INTEGER := 0;
BEGIN
  SELECT *
  INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', '예약을 찾을 수 없습니다');
  END IF;

  IF v_reservation.user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', '사용자 없는 예약입니다');
  END IF;

  PERFORM public.ensure_user_profile(v_reservation.user_id);

  IF v_reservation.status = 'EXPIRED' THEN
    v_reason := 'NO_SHOW';
    v_points := 2;
  ELSIF v_reservation.status = 'CANCELLED' THEN
    IF v_reservation.cancelled_at IS NULL THEN
      RETURN json_build_object('success', false, 'message', '취소 시각이 없습니다');
    END IF;

    IF v_reservation.cancelled_at >= v_reservation.holding_until THEN
      v_reason := 'NO_SHOW';
      v_points := 2;
    ELSIF v_reservation.cancelled_at - v_reservation.created_at >= INTERVAL '5 minutes' THEN
      v_reason := 'LATE_CANCEL';
      v_points := 1;
    ELSE
      RETURN json_build_object('success', true, 'points', 0, 'message', '패널티 대상이 아닙니다');
    END IF;
  ELSE
    RETURN json_build_object('success', true, 'points', 0, 'message', '패널티 대상 상태가 아닙니다');
  END IF;

  INSERT INTO public.penalties (user_id, reservation_id, reason, points, note)
  VALUES (
    v_reservation.user_id,
    v_reservation.id,
    v_reason,
    v_points,
    CASE v_reason
      WHEN 'NO_SHOW' THEN '노쇼 또는 만료 후 취소'
      ELSE '5분 이후 자발적 취소'
    END
  )
  ON CONFLICT (reservation_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    UPDATE public.users
    SET penalty_count = penalty_count + v_points,
        is_blocked = CASE WHEN penalty_count + v_points >= 3 THEN TRUE ELSE is_blocked END,
        blocked_until = CASE WHEN penalty_count + v_points >= 3 THEN NOW() + INTERVAL '7 days' ELSE blocked_until END,
        updated_at = NOW()
    WHERE id = v_reservation.user_id;
  END IF;

  RETURN json_build_object('success', true, 'points', v_points, 'reason', v_reason);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.apply_reservation_penalty_trigger()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('CANCELLED', 'EXPIRED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.apply_penalty_for_reservation(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_reservation_penalty_status ON public.reservations;

CREATE TRIGGER on_reservation_penalty_status
AFTER UPDATE OF status ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.apply_reservation_penalty_trigger();

-- ============================================
-- 5) 클라이언트용 안전 RPC
-- ============================================

CREATE OR REPLACE FUNCTION public.reserve_my_seat(p_seat_id BIGINT)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile public.users%ROWTYPE;
  v_existing_hold BIGINT;
  v_result JSON;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', '로그인이 필요합니다');
  END IF;

  PERFORM public.ensure_user_profile(v_user_id);

  -- cron 지연으로 남아있는 본인의 만료 HOLD가 unique index를 막지 않도록 즉시 정리.
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

  SELECT *
  INTO v_profile
  FROM public.users
  WHERE id = v_user_id;

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

  SELECT id
  INTO v_existing_hold
  FROM public.reservations
  WHERE user_id = v_user_id
    AND status = 'HOLD'
    AND holding_until > NOW()
  LIMIT 1;

  IF v_existing_hold IS NOT NULL THEN
    RETURN json_build_object('success', false, 'message', '이미 선점 중인 좌석이 있습니다');
  END IF;

  v_result := public.reserve_seat(p_seat_id, v_user_id);
  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'message', '이미 선점 중인 좌석이 있습니다');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.cancel_my_seat(p_seat_id BIGINT)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', '로그인이 필요합니다');
  END IF;

  RETURN public.cancel_seat(p_seat_id, v_user_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_current_user_holds()
RETURNS TABLE (
  reservation_id BIGINT,
  seat_id BIGINT,
  seat_number INTEGER,
  pin_code TEXT,
  holding_until TIMESTAMPTZ
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
  SELECT *
  FROM public.get_my_holds(v_user_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.verify_pin(p_pin_code TEXT)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
BEGIN
  SELECT *
  INTO v_reservation
  FROM public.reservations
  WHERE pin_code = TRIM(p_pin_code)
    AND status = 'HOLD'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', '일치하는 활성 핀코드가 없습니다');
  END IF;

  IF v_reservation.holding_until < NOW() THEN
    UPDATE public.reservations
    SET status = 'EXPIRED'
    WHERE id = v_reservation.id;

    UPDATE public.seats
    SET status = 'AVAILABLE',
        holding_until = NULL
    WHERE id = v_reservation.seat_id
      AND status = 'HOLD';

    RETURN json_build_object('success', false, 'message', '만료된 핀코드입니다');
  END IF;

  UPDATE public.reservations
  SET status = 'OCCUPIED',
      start_time = NOW()
  WHERE id = v_reservation.id;

  UPDATE public.seats
  SET status = 'OCCUPIED',
      holding_until = NULL
  WHERE id = v_reservation.seat_id;

  RETURN json_build_object(
    'success', true,
    'reservation_id', v_reservation.id,
    'seat_id', v_reservation.seat_id,
    'message', '좌석이 확정되었습니다'
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_my_penalty_summary()
RETURNS JSON
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_summary JSON;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', '로그인이 필요합니다');
  END IF;

  PERFORM public.ensure_user_profile(v_user_id);

  SELECT json_build_object(
    'success', true,
    'penalty_count', u.penalty_count,
    'is_blocked', u.is_blocked,
    'blocked_until', u.blocked_until,
    'penalties', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'id', p.id,
            'reservation_id', p.reservation_id,
            'reason', p.reason,
            'points', p.points,
            'note', p.note,
            'created_at', p.created_at
          )
          ORDER BY p.created_at DESC
        )
        FROM public.penalties p
        WHERE p.user_id = u.id
      ),
      '[]'::JSON
    )
  )
  INTO v_summary
  FROM public.users u
  WHERE u.id = v_user_id;

  RETURN v_summary;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.reserve_my_seat(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_seat(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_user_holds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_penalty_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pin(TEXT) TO anon, authenticated;
