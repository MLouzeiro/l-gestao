import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Já logado? Não mostra login de novo.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/painel");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
