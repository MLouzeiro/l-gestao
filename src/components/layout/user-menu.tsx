"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();

  async function onSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <div className="text-sm font-medium text-slate-800">{name}</div>
        <div className="text-xs text-slate-400">{email}</div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
      >
        Sair
      </button>
    </div>
  );
}
