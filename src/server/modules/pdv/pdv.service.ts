import { and, eq, isNull } from "drizzle-orm";
import {
  cashMovements,
  customers,
  products,
  stockBalances,
  tenantSettings,
  tenants,
  warehouses,
} from "@/server/db/schema";
import type {
  SaleOriginValue,
  SalePaymentMethodValue,
} from "@/server/db/schema";
import { audit } from "@/server/audit/log";
import { fromCents, toCents } from "@/lib/money";
import type { TenantTx } from "@/server/tenant/with-tenant";
import {
  registerPayment,
} from "@/server/modules/financeiro/financial.service";
import {
  billSale,
  confirmSale,
  createSale,
  type SaleContext,
  type SaleItemInput,
} from "@/server/modules/vendas/sales.service";
import { formatSaleNumber } from "@/server/modules/vendas/sales-rules";
import { getOpenCash } from "./cash.service";
import { PdvError, validatePdvPayment } from "./pdv-rules";

// Checkout do PDV: uma venda DRAFT → CONFIRMED → BILLED em UMA transação
// (o chamador envolve em withTenant) + pagamento + movimento de caixa.
// Se qualquer etapa falhar, nada é gravado (rollback transacional).

export { PdvError } from "./pdv-rules";

export type PdvCheckoutInput = {
  warehouseId: string;
  customerId?: string | null;
  paymentMethod: SalePaymentMethodValue;
  installments?: number;
  receivedCents?: number | null;
  orderDiscountCents?: number;
  notes?: string | null;
  items: readonly SaleItemInput[];
};

export type PdvCheckoutResult = {
  saleId: string;
  number: number;
  saleNumber: string;
  totalCents: number;
  trocoCents: number;
  accountIds: string[];
};

const AVISTA: readonly SalePaymentMethodValue[] = ["DINHEIRO", "PIX", "DEBITO"];

function paymentLabel(method: SalePaymentMethodValue): string {
  return method;
}

export async function checkoutPdv(
  tx: TenantTx,
  ctx: SaleContext,
  input: PdvCheckoutInput,
): Promise<PdvCheckoutResult> {
  const open = await getOpenCash(tx, ctx.tenantId);
  if (!open) throw new PdvError("Abra o caixa antes de vender.");

  const installments = input.installments ?? 1;
  const created = await createSale(tx, ctx, {
    warehouseId: input.warehouseId,
    customerId: input.customerId ?? null,
    notes: input.notes ?? null,
    installments,
    orderDiscountCents: input.orderDiscountCents,
    items: input.items,
    paymentMethod: input.paymentMethod,
    origin: "PDV",
  });

  const payment = validatePdvPayment({
    paymentMethod: input.paymentMethod,
    installments,
    totalCents: created.totals.totalCents,
    receivedCents: input.receivedCents ?? null,
  });
  if (!payment.ok) throw new PdvError(payment.reason);

  await confirmSale(tx, ctx, created.saleId);
  const billed = await billSale(tx, ctx, created.saleId);

  // À vista: o recebível nasce baixado (PAID) com o pagamento registrado.
  if (AVISTA.includes(input.paymentMethod)) {
    for (const accountId of billed.accountIds) {
      await registerPayment(
        tx,
        { tenantId: ctx.tenantId, userId: ctx.userId },
        accountId,
        {
          amountCents: created.totals.totalCents,
          paymentMethod: paymentLabel(input.paymentMethod),
          paidAt: new Date(),
          notes: `PDV ${formatSaleNumber(created.number)}`,
        },
      );
    }
  }

  // Livro do caixa: a venda entra como movimento (imutável).
  await tx.insert(cashMovements).values({
    tenantId: ctx.tenantId,
    cashRegisterId: open.id,
    type: "VENDA",
    amount: fromCents(created.totals.totalCents),
    paymentMethod: input.paymentMethod,
    saleId: created.saleId,
    description: formatSaleNumber(created.number),
    userId: ctx.userId ?? null,
  });

  await audit(tx, {
    action: "SALE_CHECKOUT",
    module: "pdv",
    entityType: "sales_orders",
    entityId: created.saleId,
    after: {
      number: created.number,
      totalCents: created.totals.totalCents,
      paymentMethod: input.paymentMethod,
      installments,
      trocoCents: payment.trocoCents,
    },
  });

  return {
    saleId: created.saleId,
    number: created.number,
    saleNumber: formatSaleNumber(created.number),
    totalCents: created.totals.totalCents,
    trocoCents: payment.trocoCents,
    accountIds: billed.accountIds,
  };
}

export type SaleOriginHint = SaleOriginValue;

// ---------------------------------------------------------------- leituras

export type PdvProduct = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  salePriceCents: number;
  available: number;
};

/** Catálogo do PDV: ativos, com disponível (saldo − reservado) do depósito. */
export async function listPdvProducts(
  tx: TenantTx,
  tenantId: string,
  warehouseId: string,
): Promise<PdvProduct[]> {
  const rows = await tx
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      barcode: products.barcode,
      salePrice: products.salePrice,
      quantity: stockBalances.quantity,
      reserved: stockBalances.reserved,
    })
    .from(products)
    .leftJoin(
      stockBalances,
      and(
        eq(stockBalances.tenantId, products.tenantId),
        eq(stockBalances.productId, products.id),
        eq(stockBalances.warehouseId, warehouseId),
      ),
    )
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.status, "ACTIVE"),
        isNull(products.deletedAt),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    barcode: r.barcode,
    salePriceCents: toCents(r.salePrice),
    available: Number(r.quantity ?? "0") - Number(r.reserved ?? "0"),
  }));
}

export type PdvCustomer = {
  id: string;
  name: string;
  document: string | null;
};

/** Clientes ativos para a seleção rápida do PDV (F6). */
export async function listPdvCustomers(
  tx: TenantTx,
  tenantId: string,
): Promise<PdvCustomer[]> {
  const rows = await tx
    .select({
      id: customers.id,
      name: customers.name,
      document: customers.document,
    })
    .from(customers)
    .where(
      and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)),
    );
  return rows;
}

export type PdvSettings = {
  tenantName: string;
  city: string;
  pixKey: string | null;
  pixCity: string | null;
  warehouseId: string;
  warehouseName: string;
};

/**
 * Configuração da tela do PDV: nome/cidade da empresa (para o QR PIX),
 * chave PIX (tenant_settings) e o depósito padrão (o primeiro cadastrado).
 */
export async function getPdvSettings(
  tx: TenantTx,
  tenantId: string,
): Promise<PdvSettings | null> {
  const [t] = await tx
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t) return null;

  const [s] = await tx
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);

  const [w] = await tx
    .select()
    .from(warehouses)
    .where(eq(warehouses.tenantId, tenantId))
    .limit(1);
  if (!w) return null;

  return {
    tenantName: t.name,
    city: t.address?.city ?? "Cidade",
    pixKey: s?.pixKey ?? null,
    pixCity: s?.pixCity ?? null,
    warehouseId: w.id,
    warehouseName: w.name,
  };
}
