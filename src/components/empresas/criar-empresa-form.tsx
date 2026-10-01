"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { _criarEmpresa, type FormState } from "@/actions/empresas";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? "Criando..." : "Criar empresa"}
    </button>
  );
}

export function CriarEmpresaForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    _criarEmpresa,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-sm font-medium text-slate-700">
        Nome da nova empresa
        <input
          name="name"
          required
          minLength={2}
          maxLength={80}
          placeholder="Ex.: Farmácia Central"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      <SubmitButton />
    </form>
  );
}
