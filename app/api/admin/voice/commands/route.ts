import { NextRequest, NextResponse } from 'next/server'
import { adminFromRequest } from '@/lib/admin-request'
import { describeCommands } from '@/lib/voice/commands/registry'

/** GET: the command catalogue, for the admin Voice Command Center. Admin only. */
export async function GET(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ commands: describeCommands() }, { headers: { 'Cache-Control': 'no-store' } })
}
