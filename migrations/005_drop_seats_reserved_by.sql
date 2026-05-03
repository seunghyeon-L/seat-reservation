-- 2026-05-03: seats.reserved_by 컬럼 삭제
-- 작성자: 백엔드 1 (승현)
-- 목적: 이전 스키마 잔재(dead column) 제거. 사용처 없음.

ALTER TABLE seats DROP COLUMN reserved_by;
