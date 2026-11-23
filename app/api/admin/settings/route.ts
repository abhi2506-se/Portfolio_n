import { NextRequest, NextResponse } from 'next/server'
import { dbGetSettings, dbSetSettings } from '@/lib/db'
import { adminFromRequest } from '@/lib/admin-request'

// Keys that hold credentials. Never returned to public (non-admin) readers.
const SECRET_KEY = /(key|secret|token|password|pass)/i

export async function GET(req: NextRequest) {
  try {
    const settings = await dbGetSettings()
    if (adminFromRequest(req)) return NextResponse.json({ settings })
    // Public readers (navbar, footer, AI assistant) get only non-secret values.
    const pub = Object.fromEntries(Object.entries(settings || {}).filter(([k]) => !SECRET_KEY.test(k)))
    return NextResponse.json({ settings: pub })
  } catch (e) {
    console.error('[settings] get error:', e)
    return NextResponse.json({ settings: {} })
  }
}

export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json()
    // Support nested { settings: {...} } or flat object
    const input = body.settings ?? body
    const allowed = [
      'whatsapp_number',
      'calendly_url',
      'hire_email_enabled',
      'resend_api_key',
      'notify_email',
      'resend_from_email',
      'chatbot_name',
      'chatbot_personal_details',
      'resume_url',
      'current_location',
      'maintenance_mode',
      'maintenance_message',
      'privacy_policy',
      'terms_of_service',
      // Version / changelog
      'site_version',
      'site_changes',
      // Social media settings
      'GITHUB_USERNAME',
      'INSTAGRAM_USERNAME',
      'INSTAGRAM_FOLLOWERS_FALLBACK',
      'LINKEDIN_FOLLOWERS',
      'TWITTER_FOLLOWERS',
      // Meeting scheduler v2
      'meeting_timezone',
      // Live chat behaviour
      'live_chat_mobile_fullscreen',
    ]
    const filtered: Record<string, string> = {}
    for (const key of allowed) {
      if (key in input) filtered[key] = String(input[key])
    }
    await dbSetSettings(filtered)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[settings] save error:', e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
