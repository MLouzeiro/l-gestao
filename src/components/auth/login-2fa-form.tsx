"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function Login2FAForm() {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function verificar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    try {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res.error) {
        setErro(res.error.message ?? "Código incorreto ou expirado.");
        return;
      }
      window.location.href = "/painel";
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={verificar} className="mt-5 space-y-3">
      <input
        name="code"
        required
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        placeholder="000000"
        autoFocus
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <button
        type="submit"
        disabled={ocupado}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {ocupado ? "Verificando..." : "Entrar"}
      </button>
    </form>
  );
}
