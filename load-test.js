import http from 'k6/http'
import { check } from 'k6'
import exec from 'k6/execution'

export const options = {
  vus: 100,        // 가상 유저 100명
  duration: '5s',  // 5초 동안
}

export default function () {
  const url = 'https://kmnviuihzsvturclzynm.supabase.co/rest/v1/seats'

  
  const userId = `user_${exec.vu.idInTest}`

  const payload = JSON.stringify({
    is_reserved: true,
    reserved_by: userId  // 예약자 이름 추가
  })
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttbnZpdWloenN2dHVyY2x6eW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNDc0NTQsImV4cCI6MjA5MDYyMzQ1NH0.rViD8kyeRr2aBUbhnpwdz7G4IZ2fOVUFBVdb30QdbKk',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttbnZpdWloenN2dHVyY2x6eW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNDc0NTQsImV4cCI6MjA5MDYyMzQ1NH0.rViD8kyeRr2aBUbhnpwdz7G4IZ2fOVUFBVdb30QdbKk',
      'Prefer': 'return=representation',
    },
  }
  
  const res = http.patch(
  `${url}?id=eq.1&is_reserved=eq.false`,
  payload,
  params
)

// 응답 결과 출력 추가
const body = JSON.parse(res.body)
if (body && body.length > 0) {
  console.log(`${userId}: 예약 성공! ✅`)
} else {
  console.log(`${userId}: 예약 실패! ❌`)
}

  check(res, {
    '요청 성공': (r) => r.status === 200,
  })
}