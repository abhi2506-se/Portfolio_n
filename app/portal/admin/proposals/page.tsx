import { redirect } from "next/navigation"
import Link from "next/link"
import { getPortalUser } from "@/lib/portal/auth"
import { ProposalsManager } from "@/components/portal/proposals-manager"
import { CoAdminManager } from "@/components/portal/co-admin-manager"
import { Tx } from '@/components/tx'

export default async function ProposalsPage() {
  const user = await getPortalUser()
  if (!user) redirect("/portal/login")
  if (user.role !== "admin" && user.role !== "co_admin") redirect("/portal/dashboard")

  const role = user.role

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold"><Tx>{"Proposals & Cold Emails"}</Tx></h1>
        <Link href="/portal/admin" className="text-sm underline"><Tx>{"← Admin Dashboard"}</Tx></Link>
      </div>

      {role === "admin" && <CoAdminManager />}

      <ProposalsManager role={role} />
    </div>
  )
}
