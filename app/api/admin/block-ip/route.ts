import { NextRequest, NextResponse } from 'next/server'
import { adminFromRequest } from '@/lib/admin-request'

// Block IP feature has been removed.
// These endpoints are kept so no 404s occur but do nothing.

export async function GET(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ blocked: [] })
}

export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ success: false, message: 'Block IP feature is disabled.' })
}

export async function DELETE(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ success: false, message: 'Block IP feature is disabled.' })
}
