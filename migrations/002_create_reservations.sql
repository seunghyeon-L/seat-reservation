-- 2026-05-03: 예약 기록 테이블 생성
-- 작성자: 백엔드 1 (승현)
-- 목적: 누가 / 언제 / 어떤 좌석을 예약했는지 기록. 패널티 계산 및 키오스크 인증의 근거 데이터.

CREATE TABLE reservations (
  id            BIGSERIAL PRIMARY KEY,
  seat_id       BIGINT REFERENCES seats(id),
  user_id       UUID REFERENCES auth.users(id),
  pin_code      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'HOLD'
                CHECK (status IN ('HOLD', 'OCCUPIED', 'CANCELLED', 'EXPIRED')),
  holding_until TIMESTAMPTZ NOT NULL,
  start_time    TIMESTAMPTZ,                  -- OCCUPIED 시 셋
  cancelled_at  TIMESTAMPTZ,                  -- CANCELLED 시 셋 (패널티 계산용)
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RLS 활성화 (정책은 Day 5에 추가 예정)
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
