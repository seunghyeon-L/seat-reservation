-- 2026-05-03: 좌석 상태를 boolean에서 3-state로 확장
-- 작성자: 백엔드 1 (승현)
-- 목적: AVAILABLE / HOLD / OCCUPIED 3가지 상태 표현 + 자동 만료 시각

ALTER TABLE seats
  DROP COLUMN is_reserved,                          -- 기존 boolean 컬럼 제거
  ADD COLUMN status TEXT NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'HOLD', 'OCCUPIED')),
  ADD COLUMN holding_until TIMESTAMPTZ;             -- 선점 만료 시각 (HOLD 아닐 땐 NULL)
