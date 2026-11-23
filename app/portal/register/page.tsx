"use client"

import { useLanguage } from "@/lib/language-context"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { COUNTRIES, LANGUAGES } from "@/lib/portal/reference-data"
import { Tx } from '@/components/tx'

export default function RegisterPage() {
  const router = useRouter()
  const { t } = useLanguage()
  const [form, setForm] = useState({
    fullName: "", email: "", password: "", phone: "", company: "",
    country: "IN", preferredLanguage: "en",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/portal/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Registration failed.")
      setSuccess(true)
      setTimeout(() => router.push("/portal/login"), 1500)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('portal.reg_title')}</CardTitle>
          <CardDescription>{t('portal.reg_sub')}</CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <p className="text-sm text-green-600">{t('portal.reg_ok')}</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">{t('portal.full_name')}</Label>
                <Input id="fullName" required value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t('portal.email')}</Label>
                <Input id="email" type="email" required value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('portal.password')}</Label>
                <Input id="password" type="password" required minLength={8} value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">{t('portal.company_opt')}</Label>
                <Input id="company" value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('portal.country')}</Label>
                  <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('portal.pref_lang')}</Label>
                  <Select value={form.preferredLanguage} onValueChange={(v) => setForm({ ...form, preferredLanguage: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {error && <p className="text-sm text-red-500"><Tx>{error}</Tx></p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('portal.creating') : t('portal.create')}
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                {t('portal.have_account')} <a href="/portal/login" className="underline">{t('portal.log_in_link')}</a>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
