"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  _cancelarCompra,
  _confirmarCompra,
  _excluirCompra,
  type CompraFormState,
} from "@/actions/compras";

type Props = {
  purchaseId: string;
  numberFormatted: string;
  status: string;
  canManage: boolean;
};

function Botao({
  children,
  tom = "primary",
  onClick,
}: {
  children: React.ReactNode;
  tom?: "primary" | "secondary" | "danger";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { pending } = useFormStatus();
  const cores =
    tom === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-700"
      : tom === "danger"
        ? "border border-rose-300 bg-white text-rose-600 hover:bg-rose-50"
        : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50";
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${cores}`}
    >
      {pending ? "Aguarde..." : children}
    </button>
  );
}

export function CompraAcoes({
  purchaseId,
  numberFormatted,
  status,
  canManage,
}: Props) {
  const [confirmar, confirmarAction] = useActionState<CompraFormState, FormData>(
    _confirmarCompra,
    null,
  );
  const [cancelar, cancelarAction] = useActionState<CompraFormState, FormData>(
    _cancelarCompra,
    null,
  );
  const [excluir, excluirAction] = useActionState<CompraFormState, FormData>(
    _excluirCompra,
    null,
  );

  const estados = [confirmar, cancelar, excluir];
  const feedback = estados
    .map((e) => (e?.error ? e.error : e?.ok ? e.message : null))
    .filter(Boolean)
    .join("  •  ");
  const temErro = estados.some((e) => e?.error);

  const router = useRouter();
  useEffect(() => {
    if (excluir?.ok) router.push("/compras");
  }, [excluir, router]);

  if (!canManage || status !== "OPEN") return null;

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={confirmarAction}>
          <input type="hidden" name="purchaseId" value={purchaseId} />
          <Botao>Confirmar (entrar estoque + gerar contas)</Botao>
        </form>
        <Link
          href={`/compras/${purchaseId}/editar`}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Editar
        </Link>
        <form action={cancelarAction}>
          <input type="hidden" name="purchaseId" value={purchaseId} />
          <Botao tom="secondary">Cancelar</Botao>
        </form>
        <form action={excluirAction}>
          <input type="hidden" name="purchaseId" value={purchaseId} />
          <Botao
            tom="danger"
            onClick={(e) => {
              if (!confirm(`Excluir a nota ${numberFormatted}?`)) e.preventDefault();
            }}
          >
            Excluir
          </Botao>
        </form>
      </div>

      {feedback && (
        <span
          className={`text-xs font-medium ${
            temErro ? "text-red-600" : "text-emerald-600"
          }`}
        >
          {feedback}
        </span>
      )}
    </div>
  );
}
