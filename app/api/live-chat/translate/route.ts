export const runtime = 'nodejs'
export const maxDuration = 30
import { NextRequest, NextResponse } from 'next/server'
import { lazySql } from '@/lib/neon-lazy'
import { ensureLiveChatSchema } from '@/lib/live-chat-db'
import { getVisitorForChat, ownsChat } from '@/lib/live-chat-identity'
import { readDeviceId } from '@/lib/device-id'
import { isLocale } from '@/lib/i18n/config'
import { activeProvider, suggestFields } from '@/lib/i18n/ai-translate'

const sql: any = lazySql
const noStore = { 'Cache-Control': 'no-store' }
const DAILY_LIMIT = 60          // translations per chat per day — bounds cost/abuse

/**
 * On-demand translation of ONE admin message for the chat's owner. Privacy rules:
 *  • only runs when the visitor explicitly clicks "Translate" (the UI shows a disclosure first);
 *  • only that single message's text is sent to the provider — never the conversation, name, e-mail or phone;
 *  • the original message is untouched; the translation is cached separately (live_chat_message_translations).
 * Body: { chatId, messageId, locale }
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => null)
    if (!b || typeof b.chatId !== 'string' || typeof b.messageId !== 'string' || !isLocale(b.locale) || b.locale === 'en')
      return NextResponse.json({ error: 'Bad request' }, { status: 400, headers: noStore })
    await ensureLiveChatSchema()
    const visitor = await getVisitorForChat(req)
    const chat = (await sql`SELECT device_id, visitor_id FROM live_chats WHERE id = ${b.chatId}`)[0]
    if (!chat || !ownsChat(chat, readDeviceId(req) || '', visitor?.visitorId ?? null, true))
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore })
    const msg = (await sql`SELECT role, content, unsent_at, media_type FROM live_chat_messages WHERE id = ${b.messageId} AND chat_id = ${b.chatId}`)[0]
    if (!msg || msg.role !== 'admin' || msg.unsent_at || msg.media_type || !msg.content)
      return NextResponse.json({ error: 'This message can’t be translated' }, { status: 400, headers: noStore })

    await sql`CREATE TABLE IF NOT EXISTS live_chat_message_translations (
      message_id TEXT NOT NULL, locale TEXT NOT NULL, chat_id TEXT NOT NULL, text TEXT NOT NULL, created_at BIGINT NOT NULL,
      PRIMARY KEY (message_id, locale))`
    const cached = (await sql`SELECT text FROM live_chat_message_translations WHERE message_id = ${b.messageId} AND locale = ${b.locale}`)[0]
    if (cached) return NextResponse.json({ text: cached.text, cached: true }, { headers: noStore })

    if (activeProvider() === 'none') return NextResponse.json({ error: 'Translation isn’t available right now.' }, { status: 501, headers: noStore })
    const used = Number((await sql`SELECT COUNT(*)::int AS n FROM live_chat_message_translations WHERE chat_id = ${b.chatId} AND created_at > ${Date.now() - 864e5}`)[0].n)
    if (used >= DAILY_LIMIT) return NextResponse.json({ error: 'Daily translation limit reached.' }, { status: 429, headers: noStore })

    const out = await suggestFields({ text: String(msg.content).slice(0, 4000) }, b.locale)
    const text = (out.text || '').trim()
    if (!text) return NextResponse.json({ error: 'Translation failed' }, { status: 502, headers: noStore })
    await sql`INSERT INTO live_chat_message_translations (message_id, locale, chat_id, text, created_at)
              VALUES (${b.messageId}, ${b.locale}, ${b.chatId}, ${text}, ${Date.now()}) ON CONFLICT DO NOTHING`
    return NextResponse.json({ text }, { headers: noStore })
  } catch (err) {
    console.error('[live-chat/translate] failed:', err)
    return NextResponse.json({ error: 'Translation failed' }, { status: 500, headers: noStore })
  }
}
