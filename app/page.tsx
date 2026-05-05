'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// 임시 테스트용 유저 UUID (백엔드 2가 Auth 완성하면 로그인된 유저로 교체)
const TEST_USER_ID = 'd714c83c-7fa2-4447-a2e4-b665fb1a5397'

type Seat = {
  id: number
  seat_number: number
  status: 'AVAILABLE' | 'HOLD' | 'OCCUPIED' // is_reserved 대신 status 사용
}

// get_my_holds RPC가 반환하는 행 형태
type MyHold = {
  reservation_id: number
  seat_id: number
  seat_number: number
  pin_code: string
  holding_until: string
}

export default function Home() {
  const [seats, setSeats] = useState<Seat[]>([])
  const [myHolds, setMyHolds] = useState<MyHold[]>([])  // 내 활성 예약 목록
  const [loading, setLoading] = useState(false)

  // 좌석 목록 + 내 예약 불러오기
  useEffect(() => {
    fetchSeats()
    fetchMyHolds()

    // 실시간 구독: seats 테이블이 바뀌면 자동으로 화면 갱신
    const channel = supabase
      .channel('seats-channel')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'seats' },
        () => {
          fetchSeats()
          fetchMyHolds()  // 좌석 변경 시 내 예약도 다시 (만료 등 반영)
        }
      )
      .subscribe()

    // 페이지 나갈 때 구독 해제
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const fetchSeats = async () => {
    const { data, error } = await supabase
      .from('seats')
      .select('*')
      .order('seat_number')

    if (error) console.error(error)
    else setSeats(data || [])
  }

  // 내 활성 HOLD 예약 목록 (get_my_holds RPC 호출)
  const fetchMyHolds = async () => {
    const { data, error } = await supabase.rpc('get_my_holds', {
      p_user_id: TEST_USER_ID,
    })

    if (error) console.error(error)
    else setMyHolds(data || [])
  }

  // 좌석 예약하기 (DB의 reserve_seat RPC 함수 호출)
  const reserveSeat = async (seatId: number) => {
    setLoading(true)

    // .rpc(함수명, 파라미터)로 DB 함수 호출
    // p_seat_id, p_user_id는 reserve_seat 함수가 받는 인자 이름
    const { data, error } = await supabase.rpc('reserve_seat', {
      p_seat_id: seatId,
      p_user_id: TEST_USER_ID,
    })

    if (error) {
      alert('예약 실패! (오류 발생)')
      console.error(error)
    } else if (data?.success) {
      // RPC가 { success: true, pin_code: '123456' } 형태로 반환
      alert(`예약 성공! ✅\n핀코드: ${data.pin_code}`)
    } else {
      // RPC가 { success: false, message: '...' } 형태로 반환
      alert(`예약 실패! ❌ (${data?.message ?? '알 수 없는 오류'})`)
    }

    fetchSeats()
    fetchMyHolds()
    setLoading(false)
  }

  // 좌석 취소 (cancel_seat RPC 호출)
  const cancelSeat = async (seatId: number) => {
    if (!confirm('정말 이 예약을 취소할까요?')) return

    setLoading(true)
    const { data, error } = await supabase.rpc('cancel_seat', {
      p_seat_id: seatId,
      p_user_id: TEST_USER_ID,
    })

    if (error) {
      alert('취소 실패! (오류 발생)')
      console.error(error)
    } else if (data?.success) {
      alert('취소 완료 ✅')
    } else {
      alert(`취소 실패! ❌ (${data?.message ?? '알 수 없는 오류'})`)
    }

    fetchSeats()
    fetchMyHolds()
    setLoading(false)
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">좌석 예약 시스템</h1>

      {/* 내 예약 패널 — 활성 예약이 있을 때만 표시 */}
      {myHolds.length > 0 && (
        <div className="mb-6 p-4 bg-blue-100 dark:bg-blue-950 rounded-lg">
          <h2 className="font-bold mb-2">내 예약</h2>
          <ul className="space-y-2">
            {myHolds.map((hold) => (
              <li
                key={hold.reservation_id}
                className="flex items-center justify-between gap-4 p-3 bg-white dark:bg-gray-800 rounded"
              >
                <span>
                  <strong>{hold.seat_number}번 좌석</strong> · 핀코드:{' '}
                  <code className="font-mono">{hold.pin_code}</code> · 만료:{' '}
                  {new Date(hold.holding_until).toLocaleTimeString()}
                </span>
                <button
                  onClick={() => cancelSeat(hold.seat_id)}
                  disabled={loading}
                  className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                >
                  취소
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-5 gap-4">
        {seats.map((seat) => (
          <button
            key={seat.id}
            onClick={() => seat.status === 'AVAILABLE' && reserveSeat(seat.id)}
            disabled={seat.status !== 'AVAILABLE' || loading}
            className={`p-4 rounded-lg text-white font-bold ${
              seat.status === 'AVAILABLE'
                ? 'bg-green-500 hover:bg-green-600'
                : seat.status === 'HOLD'
                ? 'bg-yellow-500 cursor-not-allowed' // 선점 중 = 노란색
                : 'bg-red-500 cursor-not-allowed'    // 확정됨 = 빨간색
            }`}
          >
            {seat.seat_number}번
            <br />
            {seat.status === 'AVAILABLE' ? '예약가능' : seat.status === 'HOLD' ? '선점중' : '확정됨'}
          </button>
        ))}
      </div>
    </main>
  )
}
