"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { FinancialError } from "@/server/modules/financeiro/financial-rules";
import { registerPayment } from "@/server/modules/financeiro/financial.service";
import { PermissionError } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";

// Ações do financeiro (Fase 11): baixa de conta a receber/a pagar.
// O valor vem do formulário em formato pt-BR e vira centavos no servidor —
// juros/desconto são informativos (não alteram saldo na v1).

export type FinanceFormState =
  | { ok?: boolean; error?: string; message?: string }
  | null;

const baixaSchema = z.object({
  accountId: z.string().uuid("Conta inválida."),
  amount: z.string().min(1, "Informe o valor da baixa."),
  interest: z.string().optional(),
  discount: z.string().optional(),
  paymentMethod: z.string().min(1, "Informe a forma de pagamento.").max(50),
  paidAt: z.string().optional(),
  notes: z.string().max(500).optional(),
});

type MoneyParse = { ok: true; cents: number } | { ok: false; error: string };

function parseMoney(raw: string | undefined): MoneyParse {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, cents: 0 };
  try {
    return { ok: true, cents: toCents(s) };
  } catch {
    return { ok: false, error: "Valor monetário inválido." };
  }
}

/** "YYYY-MM-DD" → Date local (meia-noite local; o serviço normaliza o dia). */
function parseLocalDate(raw: string | undefined): { ok: true; date?: Date } | { ok: false; error: string } {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false, error: "Data da baixa inválida." };
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1) {
    return { ok: false, error: "Data da baixa inválida." };
  }
  return { ok: true, date: d };
}

/** Registra a baixa — retorna `{ ok, message }` ou `{ error }`. */
export async function _registrarBaixa(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  let tenantId: string;
  let userId: string;
  try {
    const ctx = await requirePermission("finance.payments");
    tenantId = ctx.tenantId;
    userId = ctx.session.user.id;
  } catch (err) {
    if (err instanceof PermissionError) return { error: err.message };
    throw err;
  }

  const raw: Record<string, FormDataEntryValue | null> = {
    accountId: formData.get("accountId"),
    amount: formData.get("amount"),
    interest: formData.get("interest"),
    discount: formData.get("discount"),
    paymentMethod: formData.get("paymentMethod"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes"),
  };
  const parsed = baixaSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const amount = parseMoney(parsed.data.amount);
  if (!amount.ok) return { error: amount.error };
  if (amount.cents <= 0) return { error: "O valor da baixa deve ser maior que zero." };

  const interest = parseMoney(parsed.data.interest);
  if (!interest.ok) return { error: `Juros: ${interest.error}` };
  const discount = parseMoney(parsed.data.discount);
  if (!discount.ok) return { error: `Desconto: ${discount.error}` };

  const paidAt = parseLocalDate(parsed.data.paidAt);
  if (!paidAt.ok) return { error: paidAt.error };

  try {
    await withTenant(tenantId, (tx) =>
      registerPayment(tx, { tenantId, userId }, parsed.data.accountId, {
        amountCents: amount.cents,
        interestCents: interest.cents,
        discountCents: discount.cents,
        paymentMethod: parsed.data.paymentMethod,
        paidAt: paidAt.date,
        notes: parsed.data.notes ?? null,
      }),
    );
    revalidatePath("/financeiro");
    revalidatePath(`/financeiro/${parsed.data.accountId}`);
    return { ok: true, message: "Baixa registrada." };
  } catch (err) {
    if (err instanceof FinancialError) return { error: err.message };
    throw err;
  }
}
