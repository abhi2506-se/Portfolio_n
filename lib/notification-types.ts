/** Notification categories & the registry of known types (shared by server and UI). */
export const CATEGORIES = ['live_chat', 'website', 'account', 'security', 'system'] as const
export type NotificationCategory = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  live_chat: 'Live Chat',
  website: 'Website',
  account: 'Account',
  security: 'Security',
  system: 'System',
}

/** type → category. Unknown types are rejected so categories stay trustworthy. */
export const NOTIFICATION_TYPES = {
  'chat.reply': 'live_chat',
  'chat.approved': 'live_chat',
  'chat.ended': 'live_chat',
  'site.new_post': 'website',
  'site.update': 'website',
  'site.announcement': 'website',
  'account.login': 'account',
  'security.new_device': 'security',
  'security.password_changed': 'security',
  'security.account_locked': 'security',
  'system.notice': 'system',
} as const satisfies Record<string, NotificationCategory>

export type NotificationType = keyof typeof NOTIFICATION_TYPES

export interface NotificationItem {
  id: string
  category: NotificationCategory
  type: string
  title: string
  body: string
  url: string | null
  createdAt: number
  readAt: number | null
  /** Small structured params (e.g. browser/os) so the UI can render a translated message. */
  data?: Record<string, string | number> | null
}

/** Only same-site relative paths are allowed as click targets (no open redirects / javascript: URLs). */
export function safeRelativeUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  const s = u.trim()
  if (!s || s.length > 300) return null
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return null
  if (/[\u0000-\u001f]/.test(s)) return null
  return s
}
