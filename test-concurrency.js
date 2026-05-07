/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  'https://kmnviuihzsvturclzynm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttbnZpdWloenN2dHVyY2x6eW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNDc0NTQsImV4cCI6MjA5MDYyMzQ1NH0.rViD8kyeRr2aBUbhnpwdz7G4IZ2fOVUFBVdb30QdbKk'
)

async function tryReserve(userId) {
  const { data, error } = await supabase
    .from('seats')
    .update({ is_reserved: true })
    .eq('id', 1)
    .eq('is_reserved', false)
    .select()

  if (data && data.length > 0) {
    console.log(`유저 ${userId}: 예약 성공! ✅`)
  } else {
    console.log(`유저 ${userId}: 예약 실패! ❌ (이미 예약됨)`)
  }
}

// 5명이 동시에 1번 좌석 예약 시도
console.log('5명이 동시에 예약 시도...')
Promise.all([
  tryReserve(1),
  tryReserve(2),
  tryReserve(3),
  tryReserve(4),
  tryReserve(5),
])
