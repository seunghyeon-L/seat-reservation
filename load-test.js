import http from 'k6/http'
import { check } from 'k6'
import { Counter } from 'k6/metrics'

// 설정값
const SUPABASE_URL = 'https://kmnviuihzsvturclzynm.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttbnZpdWloenN2dHVyY2x6eW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNDc0NTQsImV4cCI6MjA5MDYyMzQ1NH0.rViD8kyeRr2aBUbhnpwdz7G4IZ2fOVUFBVdb30QdbKk'
const TEST_USER_ID = 'd714c83c-7fa2-4447-a2e4-b665fb1a5397'
const TEST_SEAT_ID = 1

// 성공/실패 횟수 측정용 카운터 (k6 결과 요약에 표시됨)
const reserveSuccess = new Counter('reserve_success')
const reserveFailure = new Counter('reserve_failure')

export const options = {
  scenarios: {
    burst: {
      executor: 'per-vu-iterations',  // 각 VU가 정해진 횟수만큼 실행
      vus: 500,                        // 500명의 가상 유저
      iterations: 1,                   // 각 VU가 1번씩만 호출 (총 500번)
      maxDuration: '30s',              // 30초 안에 끝나야 함
    },
  },
}

export default function () {
  const url = `${SUPABASE_URL}/rest/v1/rpc/reserve_seat`

  // RPC 함수에 전달할 파라미터 (DB 함수의 인자명과 동일하게)
  const payload = JSON.stringify({
    p_seat_id: TEST_SEAT_ID,
    p_user_id: TEST_USER_ID,
  })

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
  }

  // RPC 호출은 GET이 아니라 POST로 보냄 (Supabase REST 규칙)
  const res = http.post(url, payload, params)

  // 응답 본문 파싱 후 성공/실패 카운트
  if (res.status === 200) {
    const body = JSON.parse(res.body)
    if (body.success) {
      reserveSuccess.add(1)
    } else {
      reserveFailure.add(1)
    }
  }

  check(res, {
    'HTTP 200': (r) => r.status === 200,
  })
}
