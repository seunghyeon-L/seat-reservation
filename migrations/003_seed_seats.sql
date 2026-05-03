-- 2026-05-03: 더미 좌석 30개 시드
-- 작성자: 백엔드 1 (승현)
-- 목적: 개발/테스트용 데이터. 실제 운영 시엔 식당 현장 좌석 수에 맞춰 조정.

INSERT INTO seats (seat_number, status)
SELECT
  generate_series(1, 30),  -- 1번부터 30번까지 자동 생성
  'AVAILABLE';
