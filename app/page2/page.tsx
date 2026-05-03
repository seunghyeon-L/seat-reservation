'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Seat = {
  id: number
  seat_number: number
  is_reserved: boolean
}

export default function Home() {
  const [seats, setSeats] = useState<Seat[]>([])
  const [loading, setLoading] = useState(false)

  // 좌석 목록 불러오기
  useEffect(() => {
    fetchSeats()
  }, [])

  const fetchSeats = async () => {
    const { data, error } = await supabase
      .from('seats')
      .select('*')
      .order('seat_number')

    if (error) console.error(error)
    else setSeats(data || [])
  }

  // 좌석 예약하기
  const reserveSeat = async (seatId: number) => {
    setLoading(true)

    const { error } = await supabase
      .from('seats')
      .update({ is_reserved: true })
      .eq('id', seatId)
      .eq('is_reserved', false) // 이미 예약된 좌석은 업데이트 안 됨 (동시성 처리)

    if (error) {
      alert('예약 실패!')
    } else {
      alert('예약 성공!')
      fetchSeats() // 목록 새로고침
    }

    setLoading(false)
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">좌석 예약 시스템</h1>
      <div className="grid grid-cols-5 gap-4">
        {seats.map((seat) => (
          <button
            key={seat.id}
            onClick={() => !seat.is_reserved && reserveSeat(seat.id)}
            disabled={seat.is_reserved || loading}
            className={`p-4 rounded-lg text-white font-bold ${
              seat.is_reserved
                ? 'bg-red-500 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            {seat.seat_number}번
            <br />
            {seat.is_reserved ? '예약됨' : '예약가능'}
          </button>
        ))}
      </div>
    </main>
  )
}