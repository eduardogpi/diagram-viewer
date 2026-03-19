export default function WorkspaceLoading() {
  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="h-4 w-48 animate-pulse rounded bg-slate-800" />
        <div className="h-16 animate-pulse rounded-2xl bg-slate-900" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="h-[420px] animate-pulse rounded-2xl bg-slate-900" />
          <div className="h-[420px] animate-pulse rounded-2xl bg-slate-900" />
        </div>
      </div>
    </div>
  );
}
