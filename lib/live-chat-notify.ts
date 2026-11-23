/**
 * Live Chat → notification center. Generic wording only: no message content ever
 * leaves the chat (the notification may show on a lock screen or be shared channel-wide).
 * Never throws, so it can't break the chat action that triggers it.
 */
import { lazySql } from '@/lib/neon-lazy'
import { getPresence } from '@/lib/live-chat-db'
import { createNotification } from '@/lib/notification-center'

const sql: any = lazySql

export async function notifyChatVisitor(
  chatId: string,
  kind: 'reply' | 'approved' | 'ended',
  dedupeId: string,
): Promise<void> {
  try {
    const row = (await sql`SELECT visitor_id, device_id FROM live_chats WHERE id = ${chatId}`)[0]
    if (!row) return
    const key = row.visitor_id ? `v:${row.visitor_id}` : row.device_id ? `g:${row.device_id}` : null
    if (!key) return
    // Someone looking at the chat right now doesn't need a notification about it.
    if (kind === 'reply' && (await getPresence(chatId)).user.status === 'online') return
    const copy = {
      reply: { type: 'chat.reply', title: 'New reply from Abhishek', body: 'Tap to open your conversation.', dedupe: `chat.reply:${dedupeId}` },
      approved: { type: 'chat.approved', title: 'Your chat was approved', body: 'Abhishek can now see your conversation.', dedupe: `chat.approved:${chatId}` },
      ended: { type: 'chat.ended', title: 'Chat ended', body: 'Your live chat has ended.', dedupe: `chat.ended:${chatId}:${dedupeId}` },
    }[kind]
    await createNotification(key, { type: copy.type as any, title: copy.title, body: copy.body, url: '/?openChat=1', dedupeKey: copy.dedupe })
  } catch (err) {
    console.error('[live-chat] notify visitor failed:', err)
  }
}
