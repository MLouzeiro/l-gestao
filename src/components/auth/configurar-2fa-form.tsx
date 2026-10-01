"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type Segredo = { totpURI: string; backupCodes: string[] };

export function Configurar2FAForm({ email }: { email: string }) {
  const router = useRouter();
  const [segredo, setSegredo] = useState<Segredo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function habilitar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    const senha = String(
      new FormData(e.currentTarget).get("password") ?? "",
    );
    try {
      const res = await authClient.twoFactor.enable({ password: senha });
      if (res.error) {
        setErro(res.error.message ?? "Não foi possível habilitar. Verifique a senha.");
        return;
      }
      const data = res.data as Segredo;
      setSegredo(data);
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  async function verificar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    try {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res.error) {
        setErro(
          res.error.message ?? "Código incorreto ou expirado. Tente de novo.",
        );
        return;
      }
      router.push("/painel");
      router.refresh();
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  if (!segredo) {
    return (
      <form onSubmit={habilitar} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Digite sua senha atual para habilitar o 2FA
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Sua senha de login"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <button
          type="submit"
          disabled={ocupado}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {ocupado ? "Gerando..." : "Gerar código"}
        </button>
      </form>
    );
  }

  const uri = new URL(segredo.totpURI);
  const segredoManual = uri.searchParams.get("secret") ?? segredo.totpURI;

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
        1. No aplicativo autenticador, escolha <b>“Adicionar conta →
        Entrada manual”</b> e cole a chave abaixo para a conta{" "}
        <b>{email}</b>.
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">Chave secreta</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="select-all break-all rounded bg-slate-100 px-2 py-1 text-sm text-slate-800">
            {segredoManual}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(segredoManual)}
            className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Copiar
          </button>
        </div>
      </div>
      <div className="rounded-md bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-500">
          Códigos de recuperação (guarde em local seguro — valem para entrar
          se perder o celular)
        </p>
        <ul className="mt-1 grid grid-cols-2 gap-1 font-mono text-xs text-slate-700">
          {segredo.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <form onSubmit={verificar} className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          2. Digite o código de 6 dígitos exibido no app
          <input
            name="code"
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            autoFocus
            className="mt-1 w-40 rounded-md border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <button
          type="submit"
          disabled={ocupado}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {ocupado ? "Verificando..." : "Confirmar e ativar"}
        </button>
      </form>
    </div>
  );
}
