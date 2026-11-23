/**
 * Voice Phase 3 — SERVER-SIDE command registry (SERVER ONLY).
 *
 * Only predefined commands exist here. Each one maps to a real, existing function in this codebase
 * (lib/db settings, lib/co-admin-db, the live chat tables, and page routes). Nothing is generated
 * from natural language, and no SQL is built from speech. The browser sends a command id plus
 * validated arguments; it never decides what a command does.
 */
import { lazySql as sql } from '@/lib/neon-lazy'
import { dbGetSettings, dbSetSettings } from '@/lib/db'
import { listCoAdmins, setCoAdminEnabled, deleteCoAdmin } from '@/lib/co-admin-db'
import { adminLockVisitorDevice } from '@/lib/live-chat-db'
import type { ArgsSpec } from './args'

export type Sensitivity = 'read' | 'navigate' | 'sensitive'

export interface CommandResult {
  speech: string
  /** Client-side navigation target. Only paths from NAV_ALLOWLIST are ever returned. */
  navigate?: string
  data?: unknown
}

export interface CommandDef {
  id: string
  label: string
  category: 'navigation' | 'live_chat' | 'site' | 'team'
  sensitivity: Sensitivity
  args: ArgsSpec
  /** Required for sensitive commands. The exact phrase the admin must type to confirm. */
  confirmPhrase?: (args: Record<string, string>) => string
  run: (args: Record<string, string>) => Promise<CommandResult>
}

/** Only these routes may be navigated to by voice. */
export const NAV_ALLOWLIST = ['/admin/dashboard', '/admin/badges', '/admin/whats-new', '/', '/projects', '/journey'] as const

/** Settings that are safe to read back by voice. Anything credential-like is never listed here. */
const SAFE_SETTING_KEYS = ['maintenance_mode', 'site_version', 'chatbot_name'] as const

async function countLive() {
  const [pending] = (await sql`SELECT COUNT(*)::int AS n FROM live_chats WHERE status = 'pending' AND saved = FALSE`) as any[]
  const [active] = (await sql`SELECT COUNT(*)::int AS n FROM live_chats WHERE status <> 'closed' AND saved = FALSE`) as any[]
  const [unread] = (await sql`SELECT COUNT(*)::int AS n FROM live_chat_messages m JOIN live_chats c ON c.id = m.chat_id
    WHERE m.role = 'user' AND m.status <> 'read' AND c.status <> 'closed' AND c.saved = FALSE`) as any[]
  return { pending: Number(pending?.n ?? 0), active: Number(active?.n ?? 0), unread: Number(unread?.n ?? 0) }
}

async function maintenanceOn(): Promise<boolean> {
  const s = await dbGetSettings()
  return String(s?.maintenance_mode ?? '') === 'true'
}

async function findCoAdmin(username: string) {
  const rows = (await listCoAdmins()) as any[]
  return rows.find(r => r.username === username) ?? null
}

const navCommand = (id: string, label: string, path: (typeof NAV_ALLOWLIST)[number]): CommandDef => ({
  id, label, category: 'navigation', sensitivity: 'navigate', args: {},
  run: async () => ({ speech: `Opening ${label.toLowerCase()}.`, navigate: path }),
})

export const COMMANDS: CommandDef[] = [
  navCommand('nav.dashboard', 'Dashboard', '/admin/dashboard'),
  navCommand('nav.badges', 'Site badges', '/admin/badges'),
  navCommand('nav.whats_new', "What's new", '/admin/whats-new'),
  navCommand('nav.home', 'Home page', '/'),
  navCommand('nav.projects', 'Projects page', '/projects'),
  navCommand('nav.journey', 'Journey page', '/journey'),

  {
    id: 'live_chat.counts', label: 'Live chat summary', category: 'live_chat', sensitivity: 'read', args: {},
    run: async () => {
      const c = await countLive()
      return {
        speech: `You have ${c.pending} pending requests, ${c.active} active conversations, and ${c.unread} unread messages.`,
        data: c,
      }
    },
  },

  {
    id: 'site.maintenance_status', label: 'Maintenance status', category: 'site', sensitivity: 'read', args: {},
    run: async () => {
      const on = await maintenanceOn()
      return { speech: on ? 'Maintenance mode is on.' : 'Maintenance mode is off.', data: { active: on } }
    },
  },
  {
    id: 'site.settings_summary', label: 'Site settings summary', category: 'site', sensitivity: 'read', args: {},
    run: async () => {
      const s = (await dbGetSettings()) || {}
      const safe = Object.fromEntries(SAFE_SETTING_KEYS.map(k => [k, s[k] ?? null]))
      return { speech: `Site version is ${safe.site_version ?? 'not set'}. Maintenance mode is ${safe.maintenance_mode === 'true' ? 'on' : 'off'}.`, data: safe }
    },
  },
  {
    id: 'site.maintenance_on', label: 'Turn maintenance mode on', category: 'site', sensitivity: 'sensitive', args: {},
    confirmPhrase: () => 'CONFIRM MAINTENANCE ON',
    run: async () => {
      await dbSetSettings({ maintenance_mode: 'true' })
      return { speech: 'Maintenance mode is now on.' }
    },
  },
  {
    id: 'site.maintenance_off', label: 'Turn maintenance mode off', category: 'site', sensitivity: 'sensitive', args: {},
    confirmPhrase: () => 'CONFIRM MAINTENANCE OFF',
    run: async () => {
      await dbSetSettings({ maintenance_mode: 'false' })
      return { speech: 'Maintenance mode is now off.' }
    },
  },

  {
    id: 'visitor.lock_by_name', label: 'Lock a visitor out of the website', category: 'live_chat', sensitivity: 'sensitive',
    args: { name: 'name' },
    confirmPhrase: a => `CONFIRM LOCK ${a.name.trim().replace(/\s+/g, ' ').toUpperCase()}`,
    run: async a => {
      // Resolve the name first. It must match exactly one visitor device. Otherwise nothing changes.
      const rows = (await sql`SELECT id, device_id, user_name FROM live_chats
        WHERE LOWER(user_name) = LOWER(${a.name.trim()}) AND saved = FALSE
        ORDER BY updated_at DESC LIMIT 20`) as any[]
      if (rows.length === 0) return { speech: `No visitor named ${a.name} was found. Nothing changed.` }
      const devices = new Set(rows.map(r => r.device_id || r.id))
      if (devices.size > 1) return { speech: `More than one visitor is named ${a.name}. Nothing changed. Use the admin panel to choose.` }
      const ok = await adminLockVisitorDevice(rows[0].id, 'Locked by admin (voice command)')
      return ok ? { speech: `${rows[0].user_name} is now locked out of the website.` } : { speech: 'That visitor could not be locked. Nothing changed.' }
    },
  },

  {
    id: 'team.coadmins_list', label: 'Team members', category: 'team', sensitivity: 'read', args: {},
    run: async () => {
      const rows = (await listCoAdmins()) as any[]
      const list = rows.map(r => ({ name: r.name, username: r.username, enabled: !!r.enabled, blocked: !!r.blocked }))
      return { speech: `There are ${list.length} team members.`, data: list }
    },
  },
  {
    id: 'team.coadmin_disable', label: 'Disable a team member (revoke access)', category: 'team', sensitivity: 'sensitive',
    args: { username: 'username' },
    confirmPhrase: a => `CONFIRM DISABLE ${a.username.toUpperCase()}`,
    run: async a => {
      const r = await findCoAdmin(a.username)
      if (!r) return { speech: `No team member named ${a.username}. Nothing changed.` }
      await setCoAdminEnabled(r.id, false)
      return { speech: `${a.username} is disabled.` }
    },
  },
  {
    id: 'team.coadmin_enable', label: 'Enable a team member', category: 'team', sensitivity: 'sensitive',
    args: { username: 'username' },
    confirmPhrase: a => `CONFIRM ENABLE ${a.username.toUpperCase()}`,
    run: async a => {
      const r = await findCoAdmin(a.username)
      if (!r) return { speech: `No team member named ${a.username}. Nothing changed.` }
      await setCoAdminEnabled(r.id, true)
      return { speech: `${a.username} is enabled.` }
    },
  },
  {
    id: 'team.coadmin_remove', label: 'Remove a team member', category: 'team', sensitivity: 'sensitive',
    args: { username: 'username' },
    confirmPhrase: a => `CONFIRM REMOVE ${a.username.toUpperCase()}`,
    run: async a => {
      const r = await findCoAdmin(a.username)
      if (!r) return { speech: `No team member named ${a.username}. Nothing changed.` }
      await deleteCoAdmin(r.id)
      return { speech: `${a.username} was removed.` }
    },
  },
]

export function findCommand(id: string): CommandDef | undefined {
  return COMMANDS.find(c => c.id === id)
}

/** Safe, public description of the registry for the admin UI. No handlers, no secrets. */
export function describeCommands() {
  return COMMANDS.map(c => ({
    id: c.id, label: c.label, category: c.category, sensitivity: c.sensitivity,
    requiresConfirmation: c.sensitivity === 'sensitive',
    confirmPhrase: c.confirmPhrase ? c.confirmPhrase(Object.fromEntries(Object.keys(c.args).map(k => [k, 'USERNAME']))) : null,
    args: Object.keys(c.args),
  }))
}
