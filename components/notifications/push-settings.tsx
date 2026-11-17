'use client'
import { BellRing, BellOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/lib/language-context'
import { usePushSubscription } from '@/hooks/use-push-subscription'

export function PushSettings() {
  const { state, busy, error, enable, disable } = usePushSubscription()
  const { t } = useLanguage()
  const text: Record<string, string> = {
    loading: t('push.loading'), unsupported: t('push.unsupported'), unconfigured: t('push.unconfigured'), denied: t('push.denied'),
    default: t('push.default'), subscribed: t('push.subscribed'), 'granted-unsubscribed': t('push.granted_unsubscribed'),
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-500">
          {state === 'subscribed' ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </span>
        <div>
          <p className="text-sm font-semibold">{t('push.title')}</p>
          <p className="text-xs text-muted-foreground">{text[state]}</p>
          {error && <p role="alert" className="mt-1 text-xs text-red-500">{t(error === 'unavailable' ? 'push.error_unavailable' : 'push.error_enable')}</p>}
        </div>
      </div>
      {(state === 'default' || state === 'granted-unsubscribed') && (
        <Button size="sm" onClick={enable} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t('push.turn_on')}</Button>
      )}
      {state === 'subscribed' && <Button size="sm" variant="outline" onClick={disable} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t('push.turn_off')}</Button>}
    </div>
  )
}
