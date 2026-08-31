import { NextResponse } from 'next/server'

export function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status })
}

export function safeResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export function handleApiError(error: unknown, context: string): NextResponse {
  console.error(`[API Error] ${context}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
