"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { COUNTRIES, LANGUAGES } from "@/lib/portal/reference-data"
import { Tx, useTx } from '@/components/tx'

const TECH_OPTIONS = [
  { id: 1, name: "React" }, { id: 2, name: "Next.js" }, { id: 3, name: "Node.js" },
  { id: 4, name: "Python" }, { id: 5, name: "Django" }, { id: 6, name: "Flutter" },
  { id: 7, name: "React Native" }, { id: 8, name: "WordPress" }, { id: 9, name: "Shopify" },
]

export default function NewProjectPage() {
  const __tx = useTx();
  const router = useRouter()
  const [form, setForm] = useState({
    title: "", description: "", budgetAmount: "", advanceAmount: "",
    domain: "website", country: "IN", preferredLanguage: "en",
    timeline: "", pages: "",
  })
  const [selectedTech, setSelectedTech] = useState<number[]>([])
  const [agreedTerms, setAgreedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleTech(id: number) {
    setSelectedTech((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreedTerms) {
      setError(__tx("You must accept the Project Terms & Advance Payment/Refund Policy to continue."))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/portal/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          budgetAmount: Number(form.budgetAmount),
          budgetCurrency: "INR",
          domain: form.domain,
          country: form.country,
          preferredLanguage: form.preferredLanguage,
          advanceAmount: Number(form.advanceAmount),
          technologyIds: selectedTech,
          requirements: { timeline: form.timeline, pages: form.pages },
          acceptedTermsVersion: "v1-2026-09",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not create project.")
      router.push(`/portal/project/${data.project.id}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle><Tx>{"Start a new project"}</Tx></CardTitle>
          <CardDescription><Tx>{"Tell us what you need. You'll pay a refundable-on-rejection advance to submit it for review."}</Tx></CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label><Tx>{"Project title"}</Tx></Label>
              <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label><Tx>{"Describe your project"}</Tx></Label>
              <Textarea required rows={5} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label><Tx>{"Total budget (INR)"}</Tx></Label>
                <Input type="number" min={1} required value={form.budgetAmount}
                  onChange={(e) => setForm({ ...form, budgetAmount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label><Tx>{"Advance to pay now (INR)"}</Tx></Label>
                <Input type="number" min={1} required value={form.advanceAmount}
                  onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label><Tx>{"Domain"}</Tx></Label>
                <Select value={form.domain} onValueChange={(v) => setForm({ ...form, domain: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="website"><Tx>{"Website"}</Tx></SelectItem>
                    <SelectItem value="mobile_app"><Tx>{"Mobile App"}</Tx></SelectItem>
                    <SelectItem value="api"><Tx>{"API / Backend"}</Tx></SelectItem>
                    <SelectItem value="ecommerce"><Tx>{"E-commerce"}</Tx></SelectItem>
                    <SelectItem value="other"><Tx>{"Other"}</Tx></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label><Tx>{"Estimated timeline"}</Tx></Label>
                <Input placeholder={__tx("e.g. 6 weeks")} value={form.timeline}
                  onChange={(e) => setForm({ ...form, timeline: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label><Tx>{"Technologies (optional)"}</Tx></Label>
              <div className="flex flex-wrap gap-2">
                {TECH_OPTIONS.map((t) => (
                  <button type="button" key={t.id} onClick={() => toggleTech(t.id)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      selectedTech.includes(t.id) ? "bg-primary text-primary-foreground border-primary" : "border-input"
                    }`}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label><Tx>{"Your country"}</Tx></Label>
                <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label><Tx>{"Preferred chat language"}</Tx></Label>
                <Select value={form.preferredLanguage} onValueChange={(v) => setForm({ ...form, preferredLanguage: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox id="terms" checked={agreedTerms} onCheckedChange={(v) => setAgreedTerms(Boolean(v))} />
              <Label htmlFor="terms" className="text-sm font-normal leading-snug">
                <Tx>{"I agree to the"}</Tx>{" "}
                <a href="/terms" target="_blank" className="underline"><Tx>{"Project Terms & Conditions"}</Tx></a>,{" "}
                <a href="/refund-policy" target="_blank" className="underline"><Tx>{"Advance Payment/Refund Policy"}</Tx></a><Tx>{", and"}</Tx>{" "}
                <a href="/privacy" target="_blank" className="underline"><Tx>{"Privacy Policy"}</Tx></a>.
              </Label>
            </div>

            {error && <p className="text-sm text-red-500"><Tx>{error}</Tx></p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Tx>{"Creating…"}</Tx> : <Tx>{"Continue to Payment"}</Tx>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
