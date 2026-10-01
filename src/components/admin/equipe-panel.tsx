"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  _cancelarConvite,
  _criarConvite,
  _removerMembro,
  _trocarPapel,
  type EquipeFormState,
} from "@/actions/equipe";
import { systemRoles } from "@/server/db/schema";

type MembroUI = {
  memberId: string;
  userId: string;
  role: string;
  name: string;
  email: string;
};

type ConviteUI = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | null;
};

const papelLabel: Record<string, string> = {
  ADMIN: "Administrador",
  GERENTE: "Gerente",
  FINANCEIRO: "Financeiro",
  ESTOQUISTA: "Estoquista",
  VENDEDOR: "Vendedor",
  VISUALIZADOR: "Visualizador",
};

function Botao({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "danger" | "ghost";
}) {
  const { pending } = useFormStatus();
  const cor =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700"
      : variant === "ghost"
        ? "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
        : "bg-indigo-600 hover:bg-indigo-700";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60 ${cor}`}
    >
      {pending ? "..." : children}
    </button>
  );
}

function FormPapel({ member }: { member: MembroUI }) {
  const [state, formAction] = useActionState<EquipeFormState, FormData>(
    _trocarPapel,
    null,
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="memberId" value={member.memberId} />
      <select
        name="role"
        defaultValue={member.role}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
      >
        {systemRoles.map((r) => (
          <option key={r} value={r}>
            {papelLabel[r] ?? r}
          </option>
        ))}
      </select>
      <Botao variant="ghost">Salvar</Botao>
      {state?.error && (
        <span className="text-xs text-red-600">{state.error}</span>
      )}
    </form>
  );
}

function FormRemover({ member }: { member: MembroUI }) {
  const [state, formAction] = useActionState<EquipeFormState, FormData>(
    _removerMembro,
    null,
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Remover ${member.name} da empresa?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="memberId" value={member.memberId} />
      <Botao variant="danger">Remover</Botao>
      {state?.error && (
        <p className="mt-1 text-xs text-red-600">{state.error}</p>
      )}
    </form>
  );
}

function FormConvite() {
  const [state, formAction] = useActionState<EquipeFormState, FormData>(
    _criarConvite,
    null,
  );
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Convidar pessoa
      </h2>
      <form action={formAction} className="mt-3 flex flex-wrap gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="e-mail@empresa.com"
          className="flex-1 min-w-52 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          name="role"
          defaultValue="VENDEDOR"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          {systemRoles
            .filter((r) => r !== "ADMIN")
            .map((r) => (
              <option key={r} value={r}>
                {papelLabel[r] ?? r}
              </option>
            ))}
        </select>
        <Botao>Criar convite</Botao>
      </form>
      {state?.error && (
        <p className="mt-2 text-sm text-red-600">{state.error}</p>
      )}
      {state?.link && (
        <div className="mt-3 rounded-md bg-indigo-50 p-3">
          <p className="text-xs text-slate-600">
            Convite criado! Envie este link (sem SMTP na v1, o link também
            aparece no console do servidor):
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="truncate text-xs text-indigo-700">
              {state.link}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(state.link!)}
              className="shrink-0 rounded bg-white px-2 py-1 text-xs font-medium text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
            >
              Copiar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FormCancelarConvite({ invitationId }: { invitationId: string }) {
  return (
    <form action={_cancelarConvite}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <Botao variant="danger">Cancelar</Botao>
    </form>
  );
}

export function EquipePanel({
  members: rows,
  invitations,
  canManage,
  currentUserId,
}: {
  members: MembroUI[];
  invitations: ConviteUI[];
  canManage: boolean;
  currentUserId: string;
}) {
  const pendentes = invitations.filter((i) => i.status === "pending");

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Membros</h2>
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map((m) => (
            <li
              key={m.memberId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {m.name}
                  {m.userId === currentUserId && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      você
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">{m.email}</p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-3">
                  <FormPapel member={m} />
                  <FormRemover member={m} />
                </div>
              ) : (
                <span className="text-xs font-medium text-slate-600">
                  {papelLabel[m.role] ?? m.role}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {canManage && <FormConvite />}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Convites pendentes
          </h2>
        </div>
        {pendentes.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">
            Nenhum convite pendente.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pendentes.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">
                    {inv.email}
                  </p>
                  <p className="text-xs text-slate-500">
                    {papelLabel[inv.role] ?? inv.role}
                    {inv.expiresAt &&
                      ` · expira ${new Date(inv.expiresAt).toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
                {canManage && <FormCancelarConvite invitationId={inv.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
