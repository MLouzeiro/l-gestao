"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type Mode = "entrar" | "criar";

function mapError(message: string | undefined): string {
  if (!message) return "Não foi possível continuar. Tente novamente.";
  const m = message.toLowerCase();
  if (m.includes("invalid email or password")) return "E-mail ou senha inválidos.";
  if (m.includes("user already exists") || m.includes("already exists"))
    return "Este e-mail já está cadastrado.";
  if (m.includes("password") && (m.includes("least") || m.includes("8")))
    return "A senha precisa de pelo menos 8 caracteres.";
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("entrar");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result =
      mode === "entrar"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name, email, password });

    setLoading(false);

    if (result.error) {
      setError(mapError(result.error.message));
      return;
    }
    router.push("/painel");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white">
          L
        </div>
        <h1 className="text-xl font-semibold text-slate-900">L Gestão</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "entrar"
            ? "Entre com sua conta"
            : "Crie sua conta para começar"}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => { setMode("entrar"); setError(null); }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            mode === "entrar"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Entrar
        </button>
        <button
          type="button"
          onClick={() => { setMode("criar"); setError(null); }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            mode === "criar"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Criar conta
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {mode === "criar" && (
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
              Nome
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome completo"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com.br"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
            Senha
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "entrar" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo de 8 caracteres"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading
            ? "Aguarde..."
            : mode === "entrar"
              ? "Entrar"
              : "Criar conta"}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-slate-400">
        {mode === "entrar"
          ? "Primeiro acesso? Use a aba “Criar conta”."
          : "Novos membros entram por convite da administração da empresa."}
      </p>
    </div>
  );
}
