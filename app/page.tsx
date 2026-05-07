'use client'

import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getCurrentUser, signIn, signOut, signUp, type UserProfile } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type Seat = {
  id: number
  seat_number: number
  status: 'AVAILABLE' | 'HOLD' | 'OCCUPIED'
}

type MyHold = {
  reservation_id: number
  seat_id: number
  seat_number: number
  pin_code: string
  holding_until: string
}

type RpcResult = {
  success?: boolean
  message?: string
  pin_code?: string
  blocked_until?: string
  reservation_id?: number
  seat_id?: number
}

type Penalty = {
  id: number
  reservation_id: number | null
  reason: 'LATE_CANCEL' | 'NO_SHOW'
  points: number
  note: string | null
  created_at: string
}

type PenaltySummary = {
  success?: boolean
  message?: string
  penalty_count?: number
  is_blocked?: boolean
  blocked_until?: string | null
  penalties?: Penalty[]
}

export default function Home() {
  const [seats, setSeats] = useState<Seat[]>([])
  const [myHolds, setMyHolds] = useState<MyHold[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [penaltySummary, setPenaltySummary] = useState<PenaltySummary | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [kioskPin, setKioskPin] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let mounted = true

    const initAuth = async () => {
      try {
        const currentUser = await getCurrentUser()
        if (mounted) setUser(currentUser)
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        if (mounted) setAuthLoading(false)
      }
    }

    void initAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    void fetchSeats()

    const channel = supabase
      .channel('seats-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seats' }, () => {
        void refreshReservationState()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // refreshReservationState is intentionally read from the current render for the active user subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    void refreshReservationState()
    // refreshReservationState fans out to the current auth-scoped fetchers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const refreshReservationState = async () => {
    await fetchSeats()

    if (!user) {
      setMyHolds([])
      setPenaltySummary(null)
      setProfile(null)
      return
    }

    await Promise.all([fetchMyHolds(), fetchPenaltySummary(), fetchProfile()])
  }

  const fetchSeats = async () => {
    const { data, error } = await supabase.from('seats').select('*').order('seat_number')

    if (error) {
      console.error(error)
      setMessage('좌석 목록을 불러오지 못했습니다')
      return
    }

    setSeats(data || [])
  }

  const fetchProfile = async () => {
    if (!user) return

    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, student_id, penalty_count, is_blocked, blocked_until')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      console.error(error)
      return
    }

    setProfile(data)
  }

  const fetchMyHolds = async () => {
    const { data, error } = await supabase.rpc('get_current_user_holds')

    if (error) {
      console.error(error)
      setMessage('내 예약을 불러오지 못했습니다')
      return
    }

    setMyHolds(data || [])
  }

  const fetchPenaltySummary = async () => {
    const { data, error } = await supabase.rpc('get_my_penalty_summary')

    if (error) {
      console.error(error)
      return
    }

    setPenaltySummary((data as PenaltySummary) || null)
  }

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthLoading(true)
    setMessage('')

    try {
      if (authMode === 'signin') {
        const { user: signedInUser } = await signIn({ email, password })
        setUser(signedInUser)
        setMessage('로그인되었습니다')
      } else {
        await signUp({ email, password, name, studentId })
        setAuthMode('signin')
        setPassword('')
        setMessage('회원가입이 완료되었습니다')
      }

      setPassword('')
      await refreshReservationState()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSignOut = async () => {
    setAuthLoading(true)
    setMessage('')

    try {
      await signOut()
      setUser(null)
      setProfile(null)
      setMyHolds([])
      setPenaltySummary(null)
      setMessage('로그아웃되었습니다')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setAuthLoading(false)
    }
  }

  const reserveSeat = async (seatId: number) => {
    if (!user) {
      setMessage('예약하려면 먼저 로그인하세요')
      return
    }

    setLoading(true)
    setMessage('')

    const { data, error } = await supabase.rpc('reserve_my_seat', { p_seat_id: seatId })

    if (error) {
      console.error(error)
      setMessage('예약 실패: 서버 오류가 발생했습니다')
    } else {
      const result = data as RpcResult | null
      setMessage(
        result?.success
          ? `예약되었습니다. 핀코드: ${result.pin_code}`
          : `예약 실패: ${result?.message ?? '알 수 없는 오류'}`
      )
    }

    await refreshReservationState()
    setLoading(false)
  }

  const cancelSeat = async (seatId: number) => {
    if (!confirm('정말 이 예약을 취소할까요?')) return

    setLoading(true)
    setMessage('')

    const { data, error } = await supabase.rpc('cancel_my_seat', { p_seat_id: seatId })

    if (error) {
      console.error(error)
      setMessage('취소 실패: 서버 오류가 발생했습니다')
    } else {
      const result = data as RpcResult | null
      setMessage(result?.success ? '예약을 취소했습니다' : `취소 실패: ${result?.message ?? '알 수 없는 오류'}`)
    }

    await refreshReservationState()
    setLoading(false)
  }

  const verifyPin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!kioskPin.trim()) {
      setMessage('핀코드를 입력하세요')
      return
    }

    setLoading(true)
    setMessage('')

    const { data, error } = await supabase.rpc('verify_pin', { p_pin_code: kioskPin.trim() })

    if (error) {
      console.error(error)
      setMessage('핀코드 인증 실패: 서버 오류가 발생했습니다')
    } else {
      const result = data as RpcResult | null
      setMessage(result?.success ? result.message ?? '좌석이 확정되었습니다' : `핀코드 인증 실패: ${result?.message}`)
      if (result?.success) setKioskPin('')
    }

    await refreshReservationState()
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-neutral-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-neutral-400">Backend 2 integration</p>
            <h1 className="text-2xl font-bold">좌석 예약 시스템</h1>
          </div>

          {user ? (
            <div className="flex flex-col gap-2 text-sm md:items-end">
              <span className="text-neutral-300">{profile?.email ?? user.email}</span>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={authLoading}
                className="rounded-lg border border-neutral-700 px-3 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50"
              >
                로그아웃
              </button>
            </div>
          ) : null}
        </header>

        {message ? (
          <div className="rounded-lg border border-cyan-900 bg-cyan-950/60 px-4 py-3 text-sm text-cyan-100">
            {message}
          </div>
        ) : null}

        {!user ? (
          <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setAuthMode('signin')}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  authMode === 'signin' ? 'bg-cyan-500 text-neutral-950' : 'bg-neutral-800 text-neutral-200'
                }`}
              >
                로그인
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('signup')}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  authMode === 'signup' ? 'bg-cyan-500 text-neutral-950' : 'bg-neutral-800 text-neutral-200'
                }`}
              >
                회원가입
              </button>
            </div>

            <form onSubmit={(event) => void handleAuthSubmit(event)} className="grid gap-3 md:max-w-xl">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                placeholder="이메일"
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-3 outline-none focus:border-cyan-400"
              />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                required
                minLength={6}
                placeholder="비밀번호"
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-3 outline-none focus:border-cyan-400"
              />

              {authMode === 'signup' ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="이름"
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-3 outline-none focus:border-cyan-400"
                  />
                  <input
                    value={studentId}
                    onChange={(event) => setStudentId(event.target.value)}
                    placeholder="학번"
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-3 outline-none focus:border-cyan-400"
                  />
                </div>
              ) : null}

              <button
                type="submit"
                disabled={authLoading}
                className="rounded-lg bg-cyan-400 px-4 py-3 font-bold text-neutral-950 hover:bg-cyan-300 disabled:opacity-50"
              >
                {authLoading ? '처리 중' : authMode === 'signin' ? '로그인' : '회원가입'}
              </button>
            </form>
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <section className="flex flex-col gap-6">
              {myHolds.length > 0 ? (
                <section className="rounded-xl border border-blue-900 bg-blue-950/40 p-5">
                  <h2 className="mb-3 text-lg font-bold">내 예약</h2>
                  <ul className="space-y-3">
                    {myHolds.map((hold) => (
                      <li
                        key={hold.reservation_id}
                        className="flex flex-col gap-3 rounded-lg border border-blue-900/70 bg-neutral-950/60 p-4 md:flex-row md:items-center md:justify-between"
                      >
                        <span>
                          <strong>{hold.seat_number}번 좌석</strong>
                          <span className="mx-2 text-neutral-500">|</span>
                          핀코드 <code className="font-mono text-cyan-200">{hold.pin_code}</code>
                          <span className="mx-2 text-neutral-500">|</span>
                          만료 {new Date(hold.holding_until).toLocaleTimeString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => void cancelSeat(hold.seat_id)}
                          disabled={loading}
                          className="rounded-lg bg-red-500 px-3 py-2 text-sm font-bold text-white hover:bg-red-400 disabled:opacity-50"
                        >
                          취소
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="mb-4 text-lg font-bold">좌석 선택</h2>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {seats.map((seat) => (
                    <button
                      key={seat.id}
                      type="button"
                      onClick={() => seat.status === 'AVAILABLE' && void reserveSeat(seat.id)}
                      disabled={seat.status !== 'AVAILABLE' || loading}
                      className={`rounded-lg p-4 text-sm font-bold text-white transition ${
                        seat.status === 'AVAILABLE'
                          ? 'bg-green-600 hover:bg-green-500'
                          : seat.status === 'HOLD'
                            ? 'cursor-not-allowed bg-yellow-600'
                            : 'cursor-not-allowed bg-red-600'
                      } disabled:opacity-70`}
                    >
                      {seat.seat_number}번
                      <br />
                      {seat.status === 'AVAILABLE' ? '예약가능' : seat.status === 'HOLD' ? '선점중' : '확정됨'}
                    </button>
                  ))}
                </div>
              </section>
            </section>

            <aside className="flex flex-col gap-6">
              <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="mb-3 text-lg font-bold">키오스크 인증</h2>
                <form onSubmit={(event) => void verifyPin(event)} className="flex gap-2">
                  <input
                    value={kioskPin}
                    onChange={(event) => setKioskPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6자리 핀코드"
                    className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-3 font-mono outline-none focus:border-cyan-400"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-lg bg-cyan-400 px-4 py-3 font-bold text-neutral-950 hover:bg-cyan-300 disabled:opacity-50"
                  >
                    확인
                  </button>
                </form>
              </section>

              <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="mb-3 text-lg font-bold">패널티</h2>
                <div className="space-y-2 text-sm text-neutral-300">
                  <p>누적 점수: {penaltySummary?.penalty_count ?? profile?.penalty_count ?? 0}</p>
                  <p>
                    제한 상태:{' '}
                    {penaltySummary?.is_blocked || profile?.is_blocked
                      ? `제한 중 (${formatDate(penaltySummary?.blocked_until ?? profile?.blocked_until)})`
                      : '정상'}
                  </p>
                </div>

                {penaltySummary?.penalties?.length ? (
                  <ul className="mt-4 space-y-2 text-sm">
                    {penaltySummary.penalties.map((penalty) => (
                      <li key={penalty.id} className="rounded-lg bg-neutral-950 p-3 text-neutral-300">
                        <div className="font-semibold text-neutral-100">
                          {penalty.reason === 'NO_SHOW' ? '노쇼' : '늦은 취소'} · {penalty.points}점
                        </div>
                        <div>{formatDate(penalty.created_at)}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-neutral-500">패널티 이력이 없습니다</p>
                )}
              </section>
            </aside>
          </div>
        )}
      </div>
    </main>
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '알 수 없는 오류가 발생했습니다'
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}
