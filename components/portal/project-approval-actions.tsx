"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tx, useTx } from '@/components/tx'

export function ProjectApprovalActions({ projectId }: { projectId: string }) {
  const __tx = useTx();
  const router = useRouter()
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: "approve" | "request_changes") {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/projects/${projectId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not submit your decision.")
      router.refresh()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-blue-300 bg-blue-50">
      <CardHeader><CardTitle className="text-base"><Tx>{"Your review is needed"}</Tx></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea placeholder={__tx("Any comments (optional for approval, please describe for change requests)")} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        {error && <p className="text-sm text-red-500"><Tx>{error}</Tx></p>}
        <div className="flex gap-2">
          <Button onClick={() => decide("approve")} disabled={loading}><Tx>{"Approve & Proceed to Final Payment"}</Tx></Button>
          <Button variant="outline" onClick={() => decide("request_changes")} disabled={loading}><Tx>{"Request Changes"}</Tx></Button>
        </div>
      </CardContent>
    </Card>
  )
}
