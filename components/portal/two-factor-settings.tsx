"use client"

import { useState } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tx, useTx } from '@/components/tx'

export function TwoFactorSettings({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const __tx = useTx();
  const [enabled, setEnabled] = useState(initiallyEnabled)
  const [step, setStep] = useState<"idle" | "scanning" | "backup-codes">("idle")
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function startSetup() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/portal/admin/2fa/setup", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setQrCodeDataUrl(data.qrCodeDataUrl)
      setStep("scanning")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function confirmCode() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/portal/admin/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBackupCodes(data.backupCodes)
      setStep("backup-codes")
      setEnabled(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function disable2fa() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/portal/admin/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setEnabled(false)
      setStep("idle")
      setPassword("")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (step === "backup-codes") {
    return (
      <Card>
        <CardHeader>
          <CardTitle><Tx>{"Save your backup codes"}</Tx></CardTitle>
          <CardDescription>
            <Tx>{"Each code works once, if you lose access to your authenticator app. Store them somewhere safe — they won't be shown again."}</Tx>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-muted p-4 rounded-lg">
            {backupCodes.map((c) => <div key={c}>{c}</div>)}
          </div>
          <Button onClick={() => setStep("idle")}><Tx>{"Done"}</Tx></Button>
        </CardContent>
      </Card>
    )
  }

  if (step === "scanning") {
    return (
      <Card>
        <CardHeader>
          <CardTitle><Tx>{"Scan this QR code"}</Tx></CardTitle>
          <CardDescription><Tx>{"Use Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code."}</Tx></CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {qrCodeDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrCodeDataUrl} alt={__tx("2FA QR code")} width={200} height={200} className="rounded-lg border" />
          )}
          <div className="space-y-2 max-w-xs">
            <Label><Tx>{"Enter the code from your app"}</Tx></Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6} />
          </div>
          {error && <p className="text-sm text-red-500"><Tx>{error}</Tx></p>}
          <Button onClick={confirmCode} disabled={loading || code.length < 6}>
            {loading ? <Tx>{"Verifying…"}</Tx> : <Tx>{"Confirm & Enable 2FA"}</Tx>}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle><Tx>{"Two-factor authentication"}</Tx></CardTitle>
        <CardDescription>
          {enabled
            ? <Tx>{"2FA is currently enabled on your admin account."}</Tx>
            : <Tx>{"Add an extra layer of security to your admin account with an authenticator app."}</Tx>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {enabled ? (
          <div className="space-y-3 max-w-xs">
            <Label><Tx>{"Confirm your password to disable 2FA"}</Tx></Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <p className="text-sm text-red-500"><Tx>{error}</Tx></p>}
            <Button variant="destructive" onClick={disable2fa} disabled={loading || !password}>
              {loading ? <Tx>{"Disabling…"}</Tx> : <Tx>{"Disable 2FA"}</Tx>}
            </Button>
          </div>
        ) : (
          <>
            {error && <p className="text-sm text-red-500"><Tx>{error}</Tx></p>}
            <Button onClick={startSetup} disabled={loading}>{loading ? <Tx>{"Starting…"}</Tx> : <Tx>{"Enable 2FA"}</Tx>}</Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
