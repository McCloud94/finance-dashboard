import { ServerCrash, Inbox } from "lucide-react";

export function Loading() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-100">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-accent" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}

export function ServerDown({ message }: { message: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-100 p-8">
      <div className="max-w-md rounded-[14px] border border-gray-200 bg-paper p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-expense/10 text-expense">
          <ServerCrash size={24} strokeWidth={1.5} />
        </div>
        <h2 className="mb-2 text-[18px] font-semibold">Can't reach the data server</h2>
        <p className="mb-4 text-sm text-gray-600">{message}</p>
        <code className="block rounded-lg bg-gray-100 px-3 py-2 text-[13px]">python3 serve.py</code>
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[14px] border border-dashed border-gray-200 bg-paper px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <Inbox size={24} strokeWidth={1.5} />
      </div>
      <div className="text-[15px] font-medium">{title}</div>
      {hint && <p className="max-w-md text-sm text-gray-400">{hint}</p>}
    </div>
  );
}
