import Link from 'next/link'
import { Tx } from '@/components/tx'

export default function ProjectNotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center space-y-4 max-w-md">
        <div className="text-6xl font-black text-muted-foreground/20">404</div>
        <h1 className="text-2xl font-bold"><Tx>{"Project Not Found"}</Tx></h1>
        <p className="text-muted-foreground">
          <Tx>{"This project doesn't exist or may have been removed."}</Tx>
        </p>
        <Link
          href="/#projects"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
        >
          <Tx>{"← Back to Projects"}</Tx>
        </Link>
      </div>
    </div>
  )
}
