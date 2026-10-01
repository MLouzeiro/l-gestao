import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { Configurar2FAForm } from "@/components/auth/configurar-2fa-form";

export default async function Configurar2FAPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.twoFactorEnabled) redirect("/painel");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-slate-900">
          Configurar verificação em duas etapas (2FA)
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Obrigatório para administradores. Você precisará do seu aplicativo
          autenticador (Google Authenticator, Authy, Aegis…) na hora do login.
        </p>
        <Configurar2FAForm email={session.user.email} />
      </div>
    </div>
  );
}
