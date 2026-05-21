'use client'

import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getCurrentUser, signIn, signOut, signUp, type UserProfile } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/* ==========================================
   📦 TYPE ARCHITECTURE (데이터 규격 정의)
   ========================================== */

// 개별 좌석 정보
type Seat = {
  id: number
  seat_number: number
  status: 'AVAILABLE' | 'HOLD' | 'OCCUPIED' // 공석, 앱 예약중, 착석 완료
}

// 유저의 활성화된 예약 데이터 (영수증)
type MyHold = {
  reservation_id: number
  seat_id: number
  seat_number: number
  pin_code: string      // 현장 키오스크 인증용 6자리 번호
  holding_until: string // 자동 취소 마감 시간
}

// 유저가 착석(OCCUPIED) 중인 좌석 데이터 (체크아웃 대상)
type MyOccupied = {
  reservation_id: number
  seat_id: number
  seat_number: number
  start_time: string | null // 키오스크 인증(착석) 시각
}

// 백엔드 RPC 통신 결과 처리용
type RpcResult = {
  success?: boolean
  message?: string
  pin_code?: string
  blocked_until?: string
  reservation_id?: number
  seat_id?: number
}

// 개별 패널티 벌점 로그
type Penalty = {
  id: number
  reservation_id: number | null
  reason: 'LATE_CANCEL' | 'NO_SHOW' // 지각 취소, 노쇼
  points: number
  note: string | null
  created_at: string
}

// 유저 패널티 정보 요약
type PenaltySummary = {
  success?: boolean
  message?: string
  penalty_count?: number        // 누적 벌점
  is_blocked?: boolean          // 예약 정지 유무
  blocked_until?: string | null // 정지 해제 시간
  penalties?: Penalty[]
}

/* ==========================================
   🖥️ MAIN COMPONENT (메인 로직 및 뷰)
   ========================================== */

export default function Home() {
  /* 💡 글로벌 상태 관리 (State) */
  const [seats, setSeats] = useState<Seat[]>([])
  const [myHolds, setMyHolds] = useState<MyHold[]>([])
  const [myOccupied, setMyOccupied] = useState<MyOccupied[]>([])
  // 내가 가진 좌석 id 집합 — Realtime 콜백에서 stale closure 없이 참조
  const mySeatIdsRef = useRef<Set<number>>(new Set())
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [penaltySummary, setPenaltySummary] = useState<PenaltySummary | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(false) // 트랜잭션 중복 클릭 방지
  const [authLoading, setAuthLoading] = useState(true) // 로그인 세션 확인용
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin') // 로그인/회원가입 토글
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  //const [kioskPin, setKioskPin] = useState('')
  const [message, setMessage] = useState('')

  // 🌟 스플래시 가시성 및 애니메이션 제어
  const [showSplash, setShowSplash] = useState(true)
  const [isSplashVisible, setIsSplashVisible] = useState(true)
  
  // 🌟 지도 상에서 유저가 선택한 좌석 ID
  const [selectedSeatId, setSelectedSeatId] = useState<number | null>(null)

  // 🗺️ 'ㄴ'자 배치를 위한 가상 그리드 맵 (0: 통로, 1~8: 테이블 번호)
  const tableGrid = [
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8]
  ]

  // 각 테이블별 실제 좌석 번호(1~30) 매핑 정의
  const tableDefinitions = [
    { id: 1, label: 'A 테이블', seats: [1, 2, 3, 4] },
    { id: 2, label: 'B 테이블', seats: [5, 6, 7, 8] },
    { id: 3, label: 'C 테이블', seats: [9, 10, 11, 12] },
    { id: 4, label: 'D 테이블', seats: [13, 14, 15, 16] },
    { id: 5, label: 'E 테이블', seats: [17, 18, 19, 20] },
    { id: 6, label: 'F 테이블', seats: [21, 22, 23, 24] },
    { id: 7, label: 'G 테이블', seats: [25, 26, 27, 28] },
    { id: 8, label: 'H 테이블', seats: [29, 30] }, // 마지막 남은 2개 좌석
  ]

  // 🌟 [추가 1] 10분 실시간 카운트다운 타이머 로직
  const [secondsLeft, setSecondsLeft] = useState<number>(600) // 10분 = 600초 기본값

  useEffect(() => {
  if (myHolds.length === 0) {
    setSecondsLeft(600) // 예약이 없으면 10분으로 초기화
    return
  }

  // 1초마다 숫자를 깎아주는 타이머 구동
  const interval = setInterval(() => {
    setSecondsLeft((prev) => {
      if (prev <= 1) {
        clearInterval(interval)
        return 0 // 0초가 되면 멈춤
      }
      return prev - 1
    })
  }, 1000)

    return () => clearInterval(interval)
  }, [myHolds])

  // 초(seconds) 데이터를 "09:59" 형태로 보기 좋게 변환해 주는 변수
  const formattedTime = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`

  // 🌟 3.5초 페이드아웃 스플래시 타이머
  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setIsSplashVisible(false)
    }, 3000)

    const removeTimer = setTimeout(() => {
      setShowSplash(false)
    }, 3500)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(removeTimer)
    }
  }, [])

  // 브라우저 쿠키 기반 로그인 세션 자동 복구
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

    // 실시간 세션 만료 및 로그인 상태 변화 감지 리스너
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

  // Supabase 실시간(Realtime) 소켓 개방: 좌석 변동 내역 즉시 동기화
  useEffect(() => {
    void fetchSeats()

    const channel = supabase
      .channel('seats-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seats' }, (payload) => {
        // 🔧 팬아웃 해결: 전체 재요청 대신 "바뀐 좌석 1행"만 로컬 state에 패치
        const changed = payload.new as Seat
        if (changed?.id == null) return
        setSeats((prev) =>
          prev.some((s) => s.id === changed.id)
            ? prev.map((s) => (s.id === changed.id ? { ...s, ...changed } : s))
            : [...prev, changed].sort((a, b) => a.seat_number - b.seat_number)
        )
        // 바뀐 좌석이 "내 좌석"이면(키오스크 확정·만료 등) → 내 예약/착석만 갱신
        // (남의 좌석 변경엔 안 부름 → 팬아웃은 유지)
        if (mySeatIdsRef.current.has(changed.id)) {
          void fetchMyHolds()
          void fetchMyOccupied()
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  useEffect(() => {
    void refreshReservationState()
  }, [user?.id])

  // 내 예약/착석이 바뀔 때마다 "내 좌석 id" 집합 동기화 (Realtime 콜백용)
  useEffect(() => {
    mySeatIdsRef.current = new Set([
      ...myHolds.map((h) => h.seat_id),
      ...myOccupied.map((o) => o.seat_id),
    ])
  }, [myHolds, myOccupied])

  // 유저 로그인 상태 변화에 따른 마이페이지 데이터 갱신
  const refreshReservationState = async () => {
    await fetchSeats()

    if (!user) {
      setMyHolds([])
      setMyOccupied([])
      setPenaltySummary(null)
      setProfile(null)
      return
    }

    await Promise.all([fetchMyHolds(), fetchMyOccupied(), fetchPenaltySummary(), fetchProfile()])
  }

  // 내 액션(예약/취소/체크아웃) 후 — "내 데이터"만 가볍게 갱신.
  // 좌석맵 자체는 Realtime이 1행씩 패치하므로 fetchSeats 안 함 (팬아웃 방지).
  const refreshMyData = async () => {
    if (!user) return
    await Promise.all([fetchMyHolds(), fetchMyOccupied(), fetchPenaltySummary()])
  }

  // 데이터베이스 좌석 전체 레코드 로드
  const fetchSeats = async () => {
    const { data, error } = await supabase.from('seats').select('*').order('seat_number')

    if (error) {
      console.error(error)
      setMessage('좌석 목록을 불러오지 못했습니다')
      return
    }

    setSeats(data || [])
  }

  // 사용자 기본 인적 데이터 매핑
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

  // 유저가 현재 선점(HOLD) 중인 좌석 데이터 파싱
  const fetchMyHolds = async () => {
    const { data, error } = await supabase.rpc('get_current_user_holds')

    if (error) {
      console.error(error)
      setMessage('내 예약을 불러오지 못했습니다')
      return
    }

    setMyHolds(data || [])
  }

  // 유저가 착석(OCCUPIED) 중인 좌석 조회 (체크아웃 버튼용)
  const fetchMyOccupied = async () => {
    const { data, error } = await supabase.rpc('get_current_user_occupied')

    if (error) {
      console.error(error)
      return
    }

    setMyOccupied(data || [])
  }

  // 누적 노쇼 벌점 스택 조회
  const fetchPenaltySummary = async () => {
    const { data, error } = await supabase.rpc('get_my_penalty_summary')

    if (error) {
      console.error(error)
      return
    }

    setPenaltySummary((data as PenaltySummary) || null)
  }

  // 로그인 및 회원가입 인증 핸들러
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

  // 로그아웃 세션 클리어
  const handleSignOut = async () => {
    setAuthLoading(true)
    setMessage('')

    try {
      await signOut()
      setUser(null)
      setProfile(null)
      setMyHolds([])
      setMyOccupied([])
      setPenaltySummary(null)
      setSelectedSeatId(null)
      setMessage('로그아웃되었습니다')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setAuthLoading(false)
    }
  }

  // 백엔드 원격 좌석 선점 예약 핸들러
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
      if (result?.success) {
        setMessage(`예약되었습니다. 핀코드: ${result.pin_code}`)
        setSelectedSeatId(null) // 예약 완료 후 선택 초기화
      } else {
        setMessage(`예약 실패: ${result?.message ?? '알 수 없는 오류'}`)
      }
    }

    await refreshMyData()
    setLoading(false)
  }

  // 개인 예약 선점 즉시 취소 핸들러
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

    await refreshMyData()
    setLoading(false)
  }

  // 식사 종료 후 좌석 비우기(체크아웃) 핸들러
  const checkoutSeat = async (seatId: number) => {
    if (!confirm('식사를 마치고 좌석을 비울까요?')) return

    setLoading(true)
    setMessage('')

    const { data, error } = await supabase.rpc('checkout_my_seat', { p_seat_id: seatId })

    if (error) {
      console.error(error)
      setMessage('체크아웃 실패: 서버 오류가 발생했습니다')
    } else {
      const result = data as RpcResult | null
      setMessage(result?.success ? '체크아웃되었습니다' : `체크아웃 실패: ${result?.message ?? '알 수 없는 오류'}`)
    }

    // 즉시 반응: 체크아웃한 좌석을 화면에서 바로 제거 (낙관적 업데이트)
    setMyOccupied((prev) => prev.filter((o) => o.seat_id !== seatId))
    setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, status: 'AVAILABLE' } : s)))

    await refreshMyData()
    setLoading(false)
  }

  // 🌟 현장 키오스크 핀코드 DB 검증 핸들러
  // const verifyPin = async (event: FormEvent<HTMLFormElement>) => {
  //   event.preventDefault()

  //   if (!kioskPin.trim()) {
  //     setMessage('핀코드를 입력하세요')
  //     return
  //   }

  //   setLoading(true)
  //   setMessage('')

  //   const { data, error } = await supabase.rpc('verify_pin', { p_pin_code: kioskPin.trim() })

  //   if (error) {
  //     console.error(error)
  //     setMessage('핀코드 인증 실패: 서버 오류가 발생했습니다')
  //   } else {
  //     const result = data as RpcResult | null
  //     setMessage(result?.success ? result.message ?? '좌석이 확정되었습니다' : `핀코드 인증 실패: ${result?.message}`)
  //     if (result?.success) setKioskPin('')
  //   }

  //   await refreshReservationState()
  //   setLoading(false)
  // }

  return (
    <div className="flex min-h-screen justify-center bg-white text-neutral-100 antialiased">
      {/* 📱 모바일 디바이스 뷰포트 시뮬레이터 */}
      <div className="relative flex h-[852px] w-full max-w-[393px] flex-col overflow-hidden bg-black shadow-2xl">
        
        {/* 🌟 페이드아웃 효과 블랙 스플래시 레이어 */}
        {showSplash && (
          <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0D0D0D] text-white transition-all duration-500 pointer-events-none ${
            isSplashVisible ? 'opacity-100' : 'opacity-0 scale-105'
          }`}>
            <div className="flex items-center gap-4">
              <span className="text-6xl select-none">🍜</span> 
              <div className="text-left font-sans">
                <p className="text-base font-bold tracking-tight text-neutral-100 leading-tight">교수회관</p>
                <p className="text-base font-bold tracking-tight text-neutral-300 leading-tight mt-0.5">실시간 좌석 서비스</p>
              </div>
            </div>
          </div>
        )}

        {/* 1️⃣ 글로벌 상단 바 */}
        <header className="z-20 flex h-[60px] shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4">
          <div>
            <p className="text-[10px] text-neutral-500">Capstone Design</p>
            <h1 className="text-sm font-bold">교수회관 좌석 예약</h1>
          </div>
          {user && (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={authLoading}
              className="rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium hover:bg-neutral-800"
            >
              로그아웃
            </button>
          )}
        </header>

        {/* 시스템 메시지 얼럿 스택 */}
        {message && (
          <div className="shrink-0 bg-cyan-950 px-4 py-2.5 text-xs text-cyan-200 border-b border-cyan-900 shadow-inner flex items-center justify-between">
            <span>{message}</span>
            <button onClick={() => setMessage('')} className="ml-2 font-bold text-cyan-400 hover:text-cyan-200">
              ✕
            </button>
          </div>
        )}

        {/* 2️⃣ 메인 콘텐츠 영역 */}
        <main className="flex-1 overflow-y-auto bg-neutral-950 p-4 pb-32 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {!user ? (
            /* 🌟 세션 상태 ①: 비로그인 전용 모노톤 카드 UI */
            <div className="mt-12 rounded-2xl border border-neutral-800 bg-[#121212] p-5 shadow-2xl">
              {/* 상단 탭 스위치 (로그인 / 회원가입) */}
              <div className="mb-6 flex gap-1 rounded-xl bg-black p-1 border border-neutral-900">
                <button
                  type="button"
                  onClick={() => setAuthMode('signin')}
                  className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                    authMode === 'signin' ? 'bg-blue-600 text-white font-bold' : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  로그인
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('signup')}
                  className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                    authMode === 'signup' ? 'bg-blue-600 text-white font-bold' : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  회원가입
                </button>
              </div>

              {/* 보안 인증 인풋 필드 (선택 시 블루 테두리 포커스) */}
              <form onSubmit={(event) => void handleAuthSubmit(event)} className="grid gap-3.5">
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  required
                  placeholder="이메일"
                  className="rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm outline-none focus:border-blue-500 transition"
                />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  required
                  placeholder="비밀번호"
                  className="rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm outline-none focus:border-blue-500 transition"
                />
                {authMode === 'signup' && (
                  <>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="이름"
                      className="rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm outline-none focus:border-cyan-400"
                    />
                    <input
                      value={studentId}
                      onChange={(event) => setStudentId(event.target.value)}
                      placeholder="학번"
                      className="rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm outline-none focus:border-cyan-400"
                    />
                  </>
                )}
                {/* 🌟 유저 터치를 유도하는 파란색 시그니처 완료 버튼 */}
                <button
                  type="submit"
                  disabled={authLoading}
                  className="mt-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-500 active:scale-[0.98] transition-all shadow-lg shadow-blue-600/20"
                >
                  {authMode === 'signin' ? '로그인하기' : '회원가입 완료'}
                </button>
              </form>
            </div>
          ) : (

            /* 세션 상태 ②: 로그인 완료 세션 (실시간 좌석지도 모듈 작동) */
            <div className="flex flex-col gap-5">
              {/* 활성화된 내 실시간 예약 현황 요약 보드 */}
              {myHolds.length > 0 && (
                <div className="rounded-xl border border-blue-900 bg-blue-950/30 p-3 text-xs">
                  <h2 className="mb-2 font-bold text-blue-300">내 예약 현황</h2>
                  {myHolds.map((hold) => (
                    <div key={hold.reservation_id} className="flex items-center justify-between bg-black/40 p-2 rounded-lg">
                      <div>
                        <span className="font-bold text-white">{hold.seat_number}번 좌석</span>
                        
                        {/* 🌟 기존 남은 시간 텍스트 자리에 formattedTime 타이머 매핑 */}
                        <p className="text-[10px] text-neutral-400 mt-0.5">
                          핀코드: <span className="font-mono text-blue-400 font-bold">{hold.pin_code}</span> | 
                          남은 시간: <span className="font-mono text-red-400 font-bold ml-1">{formattedTime}</span>
                        </p>
                        
                        {/* <p className="text-[10px] text-neutral-400">핀코드: {hold.pin_code} | 만료: {new Date(hold.holding_until).toLocaleTimeString()}</p> */}
                      </div>
                      <button
                        type="button"
                        onClick={() => void cancelSeat(hold.seat_id)}
                        disabled={loading}
                        className="rounded bg-red-500/80 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-400"
                      >
                        취소
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 착석(OCCUPIED) 중인 내 좌석 — 체크아웃 */}
              {myOccupied.length > 0 && (
                <div className="rounded-xl border border-green-900 bg-green-950/30 p-3 text-xs">
                  <h2 className="mb-2 font-bold text-green-300">식사 중 좌석</h2>
                  {myOccupied.map((occ) => (
                    <div key={occ.reservation_id} className="flex items-center justify-between bg-black/40 p-2 rounded-lg">
                      <div>
                        <span className="font-bold text-white">{occ.seat_number}번 좌석</span>
                        <p className="text-[10px] text-neutral-400">확정: {occ.start_time ? new Date(occ.start_time).toLocaleTimeString() : '-'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void checkoutSeat(occ.seat_id)}
                        disabled={loading}
                        className="rounded bg-emerald-500/80 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-400"
                      >
                        체크아웃
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 디자인 가이드라인 색상 범례 라벨 */}
              <div className="flex justify-center gap-4 rounded-lg bg-neutral-900 py-2 text-[10px] text-neutral-400">
                <span className="flex items-center gap-1">⬜ 공석</span>
                <span className="flex items-center gap-1">🟨 선택중</span>
                <span className="flex items-center gap-1">🟦 선점중</span>
                <span className="flex items-center gap-1">🟥 확정됨</span>
              </div>

              {/* 2차원 배열 그리드 기반 식당 좌석 동적 레이아웃 */}
              <div className="mx-auto grid grid-cols-2 gap-x-4 gap-y-6 bg-white p-4 rounded-xl border border-gray-100 w-full justify-items-center">
                {tableGrid.flat().map((tableId, idx) => {
                  if (tableId === 0) {
                    return <div key={`empty-${idx}`} className="h-[116px] w-[104px]" /> // 빈 통로 공백 처리
                  }

                  const table = tableDefinitions.find((t) => t.id === tableId)
                  if (!table) return null

                  return (
                    <div key={table.id} className="flex w-[104px] flex-col items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/50 p-2 shadow-sm">
                      <span className="text-[9px] font-bold text-gray-400">{table.label}</span>
                      
                      {/* 테이블 상단 의자 2개 단락 */}
                      <div className="flex gap-2">
                        {table.seats.slice(0, 2).map((seatNumber) => {
                          const seat = seats.find((s) => s.seat_number === seatNumber)
                          const isSelected = selectedSeatId === seat?.id

                          // 🔥 내가 예약 중(HOLD)인 자리이거나, 이미 인증해서 식사 중(OCCUPIED)인 진짜 내 자리인지 상시 체크
                          const isMyOwnSeat = seat && user && (
                            myHolds.some((h) => h.seat_id === seat.id) || 
                            (seat.status === 'OCCUPIED' && (seat as any).user_id === user.id)
                          )

                          if (!seat) return <div key={seatNumber} className="h-8 w-8 rounded bg-gray-100" />

                          let bgClass = 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
                          if (isSelected) {
                            bgClass = 'bg-amber-400 text-gray-900 ring-2 ring-blue-600 scale-110 shadow-md z-10'
                          } else if (isMyOwnSeat) {
                            // 🔥 로그인해 있는 동안 '내 자리'는 예약을 했든 밥을 먹든 무조건 "짙은 파란색 + 광채 테두리"로 상시 강조!
                            bgClass = 'bg-blue-600 text-white font-black border-none ring-4 ring-blue-600/30 shadow-lg shadow-blue-600/20 scale-105 z-10'
                          } else if (seat.status === 'HOLD') {
                            bgClass = 'bg-blue-100 text-blue-700 border border-blue-200 cursor-not-allowed'
                          } else if (seat.status === 'OCCUPIED') {
                            bgClass = 'bg-red-100 text-red-700 border border-red-200 cursor-not-allowed'
                          }

                          return (
                            <button
                              key={seat.id}
                              type="button"
                              disabled={(seat.status !== 'AVAILABLE' && !isSelected) || loading}
                              onClick={() => setSelectedSeatId(isSelected ? null : seat.id)}
                              className={`h-8 w-8 rounded-md text-[11px] font-bold transition flex items-center justify-center ${bgClass}`}
                            >
                              {seat.seat_number}
                            </button>
                          )
                        })}
                      </div>

                      {/* 중앙 테이블 가로막 상판바 */}
                      <div className="h-1.5 w-full rounded-sm bg-amber-700/20 border border-amber-800/20" />

                      {/* 테이블 하단 의자 2개 단락 */}
                      <div className="flex gap-2">
                        {table.seats.slice(2, 4).map((seatNumber) => {
                          const seat = seats.find((s) => s.seat_number === seatNumber)
                          const isSelected = selectedSeatId === seat?.id

                          // 🔥 내 예약 리스트에 '실제 존재하는 좌석'이거나, 상태가 OCCUPIED이면서 내 ID와 100% 매칭될 때만 TRUE
                          const isMyOwnSeat = user && seat && (
                            (seat.status === 'HOLD' && myHolds.some((h) => h.seat_id === seat.id)) || 
                            (seat.status === 'OCCUPIED' && (seat as any).user_id === user.id)
                          )
                          if (!seat) return <div key={seatNumber} className="h-8 w-8 rounded bg-gray-100" />
                          // 🔥

                          let bgClass = 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
                          if (isSelected) {
                            // 1순위: 터치해서 '선택 중'인 노란색 상태
                            bgClass = 'bg-amber-400 text-gray-900 ring-2 ring-blue-600 scale-110 shadow-md z-10'
                          } else if (isMyOwnSeat) {
                          // 🔥 2순위 (상시 고정): 내 좌석에 테마 적용
                            bgClass = 'bg-[#E2E8F0] text-black font-black border-none ring-4 ring-blue-600/40 shadow-lg shadow-blue-600/20 scale-105 z-10'
                          // 🔥
                          } else if (seat.status === 'HOLD') {
                            // 3순위: '다른 계정 유저'가 앱으로 선점 중인 일반 연파란색 상태
                            bgClass = 'bg-blue-100 text-blue-700 border border-blue-200 cursor-not-allowed'
                          } else if (seat.status === 'OCCUPIED') {
                            // 4순위: '다른 계정 유저'가 핀코드 인증하고 밥 먹는 일반 빨간색 상태
                            bgClass = 'bg-red-100 text-red-700 border border-red-200 cursor-not-allowed'
                          }

                          return (
                            <button
                              key={seat.id}
                              type="button"
                              disabled={(seat.status !== 'AVAILABLE' && !isSelected) || loading}
                              onClick={() => setSelectedSeatId(isSelected ? null : seat.id)}
                              className={`h-8 w-8 rounded-md text-[11px] font-bold transition flex items-center justify-center ${bgClass}`}
                            >
                              {seat.seat_number}
                            </button>
                          )
                        })}
                        {table.seats.length === 2 && <div className="h-8 w-8" />}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* 노쇼 벌점 현황 조회 슬롯 */}
              <div className="mt-2 grid gap-4 border-t border-neutral-900 pt-4">
                {/* 🌟 현장 키오스크 통합 인증 패널
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                  <h3 className="mb-2 text-xs font-bold">현장 키오스크 인증</h3>
                  <form onSubmit={(event) => void verifyPin(event)} className="flex gap-2">
                    <input
                      value={kioskPin}
                      onChange={(event) => setKioskPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6자리 핀코드"
                      className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-black px-3 py-1.5 font-mono text-xs outline-none focus:border-cyan-400"
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-bold text-neutral-950 hover:bg-cyan-300"
                    >
                      확인
                    </button>
                  </form>
                </div> */}

                {/* 실시간 패널티 점수 조회 */}
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-xs">
                  <h3 className="mb-1 font-bold text-neutral-300">내 패널티 관리 현황</h3>
                  <p className="text-neutral-400">누적 벌점: <span className="font-bold text-red-400">{penaltySummary?.penalty_count ?? profile?.penalty_count ?? 0}점</span></p>
                  <p className="text-neutral-400">
                    이용 상태:{' '}
                    {penaltySummary?.is_blocked || profile?.is_blocked ? (
                      <span className="text-red-500 font-semibold">정지 ({formatDate(penaltySummary?.blocked_until ?? profile?.blocked_until)})</span>
                    ) : (
                      <span className="text-green-400">정상 사용 가능</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* 3️⃣ 글로벌 하단 액션 버튼 바 */}
        <footer className="absolute bottom-0 left-0 right-0 z-20 flex h-[92px] shrink-0 flex-col justify-center border-t border-neutral-800 bg-neutral-900 p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.5)]">
          {user ? (
            <button
              type="button"
              disabled={!selectedSeatId || loading}
              onClick={() => selectedSeatId && void reserveSeat(selectedSeatId)}
              className={`h-[52px] w-full rounded-xl text-sm font-bold transition ${
                selectedSeatId
                  ? 'bg-blue-600 text-white active:scale-[0.98]'
                  : 'cursor-not-allowed bg-neutral-800 text-neutral-500'
              }`}
            >
              {selectedSeatId
                ? `${seats.find((s) => s.id === selectedSeatId)?.seat_number}번 좌석 실시간 예약하기`
                : '지도의 좌석을 선택해 주세요'}
            </button>
          ) : (
            <div className="text-center text-xs text-neutral-500">
              로그인 후 서비스를 이용하실 수 있습니다.
            </div>
          )}
        </footer>

      </div>
    </div>
  )
}

// 에러 핸들링 스트링 포맷터
function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '알 수 없는 오류가 발생했습니다'
}

// 시간 문자열 정제 변환기
function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString()
}
