"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { _aceitarConvite, type EquipeFormState } from "@/actions/equipe";

function Botao({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? "Aceitando..." : "Aceitar convite"}
    </button>
  );
}

export function AceitarConviteForm({
  invitationId,
  bloqueado,
}: {
  invitationId: string;
  bloqueado?: boolean;
}) {
  const [state, formAction] = useActionState<EquipeFormState, FormData>(
    _aceitarConvite,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="invitationId" value={invitationId} />
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      <Botao disabled={bloqueado} />
    </form>
  );
}
