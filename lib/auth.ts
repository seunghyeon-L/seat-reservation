import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type SignUpInput = {
  email: string
  password: string
  name?: string
  studentId?: string
}

export type SignInInput = {
  email: string
  password: string
}

export type UserProfile = {
  id: string
  email: string | null
  name: string | null
  student_id: string | null
  penalty_count: number
  is_blocked: boolean
  blocked_until: string | null
}

export async function signUp({ email, password, name, studentId }: SignUpInput) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: name?.trim() || null,
        student_id: studentId?.trim() || null,
      },
    },
  })

  if (error) throw error

  if (data.user && data.session) {
    await upsertMyProfile(data.user, name, studentId)
  }

  return data
}

export async function signIn({ email, password }: SignInInput) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error

  if (data.user) {
    await upsertMyProfile(data.user)
  }

  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession()
  if (!session) return null

  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data.user
}

export async function getMyProfile(): Promise<UserProfile | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, student_id, penalty_count, is_blocked, blocked_until')
    .eq('id', user.id)
    .maybeSingle()

  if (error) throw error
  return data
}

async function upsertMyProfile(user: User, name?: string, studentId?: string) {
  const profile = {
    id: user.id,
    email: user.email ?? null,
    name: name?.trim() || (user.user_metadata?.name as string | undefined) || null,
    student_id:
      studentId?.trim() || (user.user_metadata?.student_id as string | undefined) || null,
  }

  const { error } = await supabase.from('users').upsert(profile, { onConflict: 'id' })
  if (error) throw error
}
