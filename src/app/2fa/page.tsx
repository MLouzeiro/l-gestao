import { Login2FAForm } from "@/components/auth/login-2fa-form";

// Página de desafio 2FA no login (twoFactorClient twoFactorPage="/2fa").
// Fica fora do grupo (app): o desafio acontece ANTES da sessão existir.
export default function Login2FAPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-700">
          E
        </div>
        <h1 className="mt-4 text-center text-lg font-semibold text-slate-900">
          Verificação em duas etapas
        </h1>
        <p className="mt-2 text-center text-sm text-slate-600">
          Digite o código do seu aplicativo autenticador para concluir o
          login.
        </p>
        <Login2FAForm />
      </div>
    </div>
  );
}
