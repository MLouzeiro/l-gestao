import { pgEnum } from "drizzle-orm/pg-core";

export const tenantSegmentEnum = pgEnum("tenant_segment", [
  "COMERCIO_GERAL",
  "FARMACIA",
  "LABORATORIO",
  "SAUDE",
  "LANCHONETE",
  "FRIGORIFICO",
  "OUTRO",
]);

export const tenantStatusEnum = pgEnum("tenant_status", [
  "TRIAL",
  "ACTIVE",
  "SUSPENDED",
]);

export const costMethodEnum = pgEnum("cost_method", ["MEDIO", "FIFO"]);

export const movementTypeEnum = pgEnum("movement_type", [
  "ENTRADA_COMPRA",
  "ENTRADA_DEVOLUCAO",
  "ENTRADA_AJUSTE",
  "SAIDA_VENDA",
  "SAIDA_DEVOLUCAO_FORNECEDOR",
  "SAIDA_PERDA",
  "SAIDA_QUEBRA",
  "SAIDA_VENCIMENTO",
  "SAIDA_AJUSTE",
  "TRANSFERENCIA_SAIDA",
  "TRANSFERENCIA_ENTRADA",
]);

export const reservationStatusEnum = pgEnum("reservation_status", [
  "ACTIVE",
  "RELEASED",
  "CONSUMED",
  "EXPIRED",
]);

export const purchaseStatusEnum = pgEnum("purchase_status", [
  "OPEN",
  "CONFIRMED",
  "CANCELLED",
]);

export const saleStatusEnum = pgEnum("sale_status", [
  "DRAFT",
  "CONFIRMED",
  "BILLED",
  "CANCELLED",
  "RETURNED",
]);

export const productStatusEnum = pgEnum("product_status", [
  "ACTIVE",
  "INACTIVE",
  "DISCONTINUED",
]);

export const financialDirectionEnum = pgEnum("financial_direction", [
  "PAYABLE",
  "RECEIVABLE",
]);

export const financialSourceEnum = pgEnum("financial_source", [
  "SALE",
  "PURCHASE",
  "RETURN",
  "MANUAL",
]);

export const financialStatusEnum = pgEnum("financial_status", [
  "OPEN",
  "OVERDUE",
  "PAID",
  "PARTIAL",
  "CANCELLED",
]);

export const salePaymentMethodEnum = pgEnum("sale_payment_method", [
  "DINHEIRO",
  "PIX",
  "DEBITO",
  "CREDITO",
  "VALE",
  "OUTRO",
]);

export const saleOriginEnum = pgEnum("sale_origin", [
  "PDV",
  "VENDA",
  "ONLINE",
  "IMPORT",
]);

export const cashStatusEnum = pgEnum("cash_status", ["OPEN", "CLOSED"]);

export const cashMovementTypeEnum = pgEnum("cash_movement_type", [
  "ABERTURA",
  "VENDA",
  "SUPRIMENTO",
  "SANGRIA",
  "FECHAMENTO",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "SUSPENDED",
]);

export const warehouseTypeEnum = pgEnum("warehouse_type", [
  "MATRIZ",
  "FILIAL",
  "POSTO",
]);

export const transferStatusEnum = pgEnum("transfer_status", [
  "DRAFT",
  "SENT",
  "RECEIVED",
  "CANCELLED",
]);

export const transferSettleOnEnum = pgEnum("transfer_settle_on", [
  "SEND",
  "RECEIVE",
]);
