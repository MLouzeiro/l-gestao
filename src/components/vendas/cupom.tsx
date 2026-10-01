"use client";

import { formatBRL } from "@/lib/money";

// Cupom não fiscal (térmico 80mm) — impressão via window.print().
// O CSS de impressão (globals.css) esconde a app e mostra só #cupom-impressao.
// NFC-e (com chave/assinatura) é fase futura — ver docs/PROGRESSO.md.

type EmpresaCupom = {
  name: string;
  tradingName: string | null;
  legalName: string | null;
  document: string | null;
};

type VendaCupom = {
  number: number;
  customerName: string | null;
  sellerName: string | null;
  warehouseName: string;
  notes: string | null;
  subtotalCents: number;
  itemDiscountCents: number;
  orderDiscountCents: number;
  totalCents: number;
  createdAt: Date;
  billedAt: Date | null;
  items: {
    id: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    lineTotalCents: number;
    batchNumber: string | null;
  }[];
};

function numeroVenda(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  return `VENDA-${String(v).padStart(6, "0")}`;
}

function formatQty(q: number): string {
  return q.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function dataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Separador() {
  return <div className="my-1.5 border-t border-dashed border-black/70" />;
}

function LinhaTotais({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{valor}</span>
    </div>
  );
}

export function CupomNaoFiscal({
  venda,
  empresa,
}: {
  venda: VendaCupom;
  empresa: EmpresaCupom;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        Imprimir cupom (80mm)
      </button>

      <div id="cupom-impressao" className="cupom-impressao">
        <div className="text-center">
          <p className="text-sm font-bold uppercase">
            {empresa.tradingName ?? empresa.name}
          </p>
          {empresa.legalName && <p>{empresa.legalName}</p>}
          {empresa.document && <p>CNPJ: {empresa.document}</p>}
          <p className="mt-1.5 font-bold tracking-widest">CUPOM NÃO FISCAL</p>
        </div>

        <Separador />

        <p>{numeroVenda(venda.number)}</p>
        <p>Emissão: {dataHora(venda.billedAt ?? venda.createdAt)}</p>
        <p>Cliente: {venda.customerName ?? "Consumidor"}</p>
        {venda.sellerName && <p>Vendedor: {venda.sellerName}</p>}
        <p>Depósito: {venda.warehouseName}</p>

        <Separador />

        <div className="space-y-1.5">
          {venda.items.map((i) => (
            <div key={i.id}>
              <p className="font-medium">{i.productName}</p>
              <div className="flex justify-between gap-2">
                <span>
                  {formatQty(i.quantity)} × {formatBRL(i.unitPriceCents)}
                  {i.batchNumber ? ` · lote ${i.batchNumber}` : ""}
                </span>
                <span>{formatBRL(i.lineTotalCents)}</span>
              </div>
              {i.discountCents > 0 && (
                <div className="flex justify-between">
                  <span>desconto item</span>
                  <span>− {formatBRL(i.discountCents)}</span>
                </div>
              )}
              <p className="text-[10px]">{i.sku}</p>
            </div>
          ))}
        </div>

        {venda.notes?.trim() && (
          <p className="mt-1.5 text-[10px]">Obs: {venda.notes}</p>
        )}

        <Separador />

        <div className="space-y-0.5">
          <LinhaTotais
            label="Subtotal"
            valor={formatBRL(venda.subtotalCents)}
          />
          {venda.itemDiscountCents > 0 && (
            <LinhaTotais
              label="Desconto itens"
              valor={`− ${formatBRL(venda.itemDiscountCents)}`}
            />
          )}
          {venda.orderDiscountCents > 0 && (
            <LinhaTotais
              label="Desconto pedido"
              valor={`− ${formatBRL(venda.orderDiscountCents)}`}
            />
          )}
          <div className="flex justify-between border-t border-dashed border-black/70 pt-1 text-base font-bold">
            <span>TOTAL</span>
            <span>{formatBRL(venda.totalCents)}</span>
          </div>
        </div>

        <Separador />

        <div className="text-center text-[10px]">
          <p>Documento sem valor fiscal</p>
          <p>NFC-e em fase de implementação</p>
          <p className="mt-2 font-bold">Obrigado pela preferência!</p>
        </div>
      </div>
    </>
  );
}
