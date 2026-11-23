import { redirect } from "next/navigation"
import Link from "next/link"
import { getPortalUser } from "@/lib/portal/auth"
import { getServerSupabase } from "@/lib/portal/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { STATUS_LABELS, STATUS_COLOR } from "@/lib/portal/status-labels"
import { Tx } from '@/components/tx'

export default async function DashboardPage() {
  const user = await getPortalUser()
  if (!user) redirect("/portal/login")
  if (user.role === "admin") redirect("/portal/admin")
  if (user.role === "co_admin") redirect("/portal/admin/proposals")

  const supabase = await getServerSupabase()
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false })

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold"><Tx>{"Welcome back,"}</Tx> {user.full_name.split(" ")[0]}</h1>
          <p className="text-muted-foreground"><Tx>{"Here's where your projects stand."}</Tx></p>
        </div>
        <Button asChild>
          <Link href="/portal/project/new"><Tx>{"+ New Project"}</Tx></Link>
        </Button>
      </div>

      {(!projects || projects.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Tx>{"You don't have any projects yet."}</Tx>
            <div className="mt-4">
              <Button asChild><Link href="/portal/project/new"><Tx>{"Start your first project"}</Tx></Link></Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/portal/project/${p.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg"><Tx>{p.title}</Tx></CardTitle>
                    <Badge className={STATUS_COLOR[p.status] ?? ""}>{STATUS_LABELS[p.status] ?? p.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4"><Tx>{p.description}</Tx></p>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span><Tx>{"Progress"}</Tx></span><span>{p.progress_percent}%</span>
                    </div>
                    <Progress value={p.progress_percent} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
