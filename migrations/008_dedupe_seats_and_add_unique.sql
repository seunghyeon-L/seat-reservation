-- 2026-05-03: seats 중복 제거 + seat_number UNIQUE 제약
-- 작성자: 백엔드 1 (승현)
-- 배경:
--   ERD 상으로는 seat_number가 UNIQUE인데 CREATE TABLE 시 누락됨.
--   시드 SQL이 중복 실행돼서 같은 seat_number가 여러 행으로 존재.
--   화면에 중복 좌석이 보이는 버그 발생.

-- 1) 중복된 seats 행이 reservations에서 참조되고 있을 수 있으므로 먼저 정리
DELETE FROM reservations
WHERE seat_id IN (
  SELECT id FROM seats
  WHERE id NOT IN (
    SELECT MIN(id) FROM seats GROUP BY seat_number  -- 각 seat_number의 최소 id만 keep
  )
);

-- 2) 중복 seats 삭제 (각 seat_number에서 가장 작은 id만 남김)
DELETE FROM seats
WHERE id NOT IN (
  SELECT MIN(id) FROM seats GROUP BY seat_number
);

-- 3) 향후 중복 방지: UNIQUE 제약 추가
ALTER TABLE seats
  ADD CONSTRAINT seats_seat_number_unique UNIQUE (seat_number);
