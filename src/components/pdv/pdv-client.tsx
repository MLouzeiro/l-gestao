"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { formatBRL, toCents } from "@/lib/money";
import { buildPixPayload } from "@/lib/pix";
import { resolveProductByCode } from "@/lib/sale-scan";
import { calcTroco } from "@/server/modules/pdv/pdv-rules";
import { _checkoutPdv } from "@/actions/pdv";
import { KpiStrip, type KpiItem } from "@/components/metrics/kpi-strip";
import type {
  PdvCustomer,
  PdvProduct,
  PdvSettings,
} from "@/server/modules/pdv/pdv.service";
import type { CashSummary } from "@/server/modules/pdv/cash.service";
import { CashModal, type CashModalKind } from "./cash-modals";
import { PixModal } from "./pix-modal";
import { ShortcutHelp } from "./shortcut-help";

// Frente de caixa (PDV) — layout do l-estoque (busca + grid | carrinho) com
// caixa, troco, PIX e atalhos F1–F9. Validação real acontece no servidor.

type CartItem = {
  productId: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  available: number;
};

type Feedback = { type: "success" | "error"; message: string } | null;

const PAY_BUTTONS = [
  { method: "DINHEIRO", label: "Dinheiro" },
  { method: "PIX", label: "PIX" },
  { method: "DEBITO", label: "Débito" },
  { method: "CREDITO", label: "Crédito" },
] as const;

type PayMethod = (typeof PAY_BUTTONS)[number]["method"];

export function PdvClient({
  products,
  customers,
  settings,
  cash,
  canFinance,
}: {
  products: PdvProduct[];
  customers: PdvCustomer[];
  settings: PdvSettings;
  cash: CashSummary;
  canFinance: boolean;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const payRef = useRef<HTMLDivElement>(null);

  const [busca, setBusca] = useState("");
  const [qtdInput, setQtdInput] = useState("1");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>("DINHEIRO");
  const [installments, setInstallments] = useState(1);
  const [receivedInput, setReceivedInput] = useState("");
  const [discountInput, setDiscountInput] = useState("");
  const [customer, setCustomer] = useState<PdvCustomer | null>(null);
  const [showCustomers, setShowCustomers] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [pixOpen, setPixOpen] = useState(false);
  const [cashModal, setCashModal] = useState<CashModalKind | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);

  const totalCents = useMemo(
    () =>
      cart.reduce((acc, i) => acc + i.unitPriceCents * i.quantity, 0),
    [cart],
  );

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? "").includes(q),
    );
  }, [busca, products]);

  const pixPayload = useMemo(() => {
    if (!settings.pixKey || totalCents <= 0) return "";
    return buildPixPayload({
      key: settings.pixKey,
      name: settings.tenantName,
      city: settings.pixCity ?? settings.city,
      txid: `PDV${Date.now().toString().slice(-6)}`,
      amountCents: totalCents,
    });
    // txid fixo por valor: o payload é estável enquanto o total não muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, totalCents]);

  function addItem(productId: string): void {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const qtd = Math.max(1, Number.parseInt(qtdInput, 10) || 1);
    const existing = cart.find((i) => i.productId === productId);
    const newQty = (existing?.quantity ?? 0) + qtd;
    if (newQty > product.available) {
      setFeedback({
        type: "error",
        message: `Estoque insuficiente de ${product.name} (disponível: ${product.available}).`,
      });
      return;
    }
    setCart((prev) =>
      existing
        ? prev.map((i) =>
            i.productId === productId ? { ...i, quantity: newQty } : i,
          )
        : [
            ...prev,
            {
              productId: product.id,
              sku: product.sku,
              name: product.name,
              unitPriceCents: product.salePriceCents,
              quantity: qtd,
              available: product.available,
            },
          ],
    );
    setQtdInput("1");
    setBusca("");
    setFeedback(null);
    searchRef.current?.focus();
  }

  function removeItem(productId: string): void {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
    setSelectedKey(null);
  }

  async function finalizar(): Promise<void> {
    if (busy) return;
    if (cart.length === 0) {
      setFeedback({ type: "error", message: "Carrinho vazio." });
      return;
    }
    let receivedCents: number | null = null;
    let orderDiscountCents = 0;
    try {
      if (paymentMethod === "DINHEIRO") {
        receivedCents = toCents(receivedInput || "0");
      }
      if (discountInput.trim()) {
        orderDiscountCents = toCents(discountInput);
      }
    } catch {
      setFeedback({ type: "error", message: "Valor digitado inválido." });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const res = await _checkoutPdv({
        warehouseId: settings.warehouseId,
        customerId: customer?.id ?? null,
        paymentMethod,
        installments: paymentMethod === "CREDITO" ? installments : 1,
        receivedCents,
        orderDiscountCents:
          orderDiscountCents > 0 ? orderDiscountCents : undefined,
        items: cart.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
        })),
      });
      if (!res.ok) {
        setFeedback({ type: "error", message: res.error });
        return;
      }
      setLastSaleId(res.data.saleId);
      setFeedback({
        type: "success",
        message: `Venda ${res.data.saleNumber} registrada — total ${formatBRL(
          res.data.totalCents,
        )}${
          res.data.trocoCents > 0 ? ` · troco ${formatBRL(res.data.trocoCents)}` : ""
        } — F8 abre o cupom.`,
      });
      setCart([]);
      setSelectedKey(null);
      setReceivedInput("");
      setDiscountInput("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Atalhos F1–F9 (teclado de balcão) — ref evita closure velha no F5/F9.
  const finalizarRef = useRef(finalizar);
  finalizarRef.current = finalizar;
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const lastSaleIdRef = useRef(lastSaleId);
  lastSaleIdRef.current = lastSaleId;

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      switch (e.key) {
        case "F1":
          e.preventDefault();
          setShowHelp((v) => !v);
          break;
        case "F2":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "F3":
          e.preventDefault();
          qtyRef.current?.focus();
          qtyRef.current?.select();
          break;
        case "F4":
          e.preventDefault();
          discountRef.current?.focus();
          break;
        case "F5":
          e.preventDefault();
          void finalizarRef.current();
          break;
        case "F6":
          e.preventDefault();
          setShowCustomers((v) => !v);
          break;
        case "F7":
          e.preventDefault();
          payRef.current?.focus();
          break;
        case "F8":
          e.preventDefault();
          if (lastSaleIdRef.current) router.push(`/vendas/${lastSaleIdRef.current}`);
          break;
        case "F9":
          e.preventDefault();
          if (selectedKeyRef.current) removeItem(selectedKeyRef.current);
          break;
        case "Escape":
          setShowHelp(false);
          setPixOpen(false);
          setCashModal(null);
          setShowCustomers(false);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const exact = resolveProductByCode(products, busca);
    if (exact?.status === "found") {
      addItem(exact.product.id);
      return;
    }
    if (filtered.length === 1) addItem(filtered[0].id);
  }

  const receivedCents = (() => {
    if (paymentMethod !== "DINHEIRO" || !receivedInput.trim()) return null;
    try {
      return toCents(receivedInput);
    } catch {
      return null;
    }
  })();
  const troco =
    receivedCents != null && receivedCents >= totalCents
      ? calcTroco(receivedCents, totalCents)
      : null;

  const kpis: KpiItem[] = [
    {
      label: "Caixa",
      value: cash.open ? `Aberto #${cash.number}` : "Fechado",
      hint: cash.open
        ? `desde ${cash.openedAt ? new Date(cash.openedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}`
        : "abra para vender",
      tone: cash.open ? "success" : "warning",
    },
    {
      label: "Vendas no caixa",
      value: String(cash.salesCount),
    },
    {
      label: "Total vendido",
      value: formatBRL(cash.salesTotalCents),
    },
    {
      label: "Esperado em dinheiro",
      value: formatBRL(cash.expected.cash),
      hint: `abertura ${formatBRL(cash.openingAmountCents)}`,
    },
  ];

  return (
    <div className="flex h-[calc(100vh-4.5rem)] flex-col gap-3">
      {/* Cabeçalho: KPIs + ações de caixa */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <KpiStrip items={kpis} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Atalhos (F1)
          </button>
          {!cash.open ? (
            <button
              type="button"
              onClick={() => setCashModal("abrir")}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
            >
              Abrir caixa
            </button>
          ) : (
            <>
              {canFinance && (
                <>
                  <button
                    type="button"
                    onClick={() => setCashModal("suprimento")}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Suprimento
                  </button>
                  <button
                    type="button"
                    onClick={() => setCashModal("sangria")}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Sangria
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setCashModal("fechar")}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
              >
                Fechar caixa
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <p
          className={`rounded-lg p-3 text-sm font-semibold ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* Esquerda: busca + grade de produtos */}
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex gap-3 rounded-xl bg-slate-900 p-3">
            <div className="w-24">
              <label
                htmlFor="pdv-qtd"
                className="ml-1 text-xs font-bold text-slate-400"
              >
                QTD (F3)
              </label>
              <input
                id="pdv-qtd"
                ref={qtyRef}
                type="number"
                min={1}
                value={qtdInput}
                onChange={(e) => setQtdInput(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-center text-xl font-bold text-white"
              />
            </div>
            <div className="relative flex-1">
              <label
                htmlFor="pdv-busca"
                className="ml-1 text-xs font-bold text-slate-400"
              >
                BUSCAR (F2) — nome, SKU ou código de barras
              </label>
              <input
                id="pdv-busca"
                ref={searchRef}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Escaneie ou digite e tecle Enter..."
                autoFocus
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 pl-4 text-lg text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto md:grid-cols-3 xl:grid-cols-4">
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addItem(p.id)}
                disabled={p.available <= 0}
                className="flex h-[150px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all hover:border-emerald-400 hover:shadow-md disabled:opacity-40"
              >
                <p className="line-clamp-2 text-xs font-bold text-slate-800">
                  {p.name}
                </p>
                <div>
                  <div className="flex items-end justify-between">
                    <span
                      className={`rounded px-1 text-[10px] ${
                        p.available > 0
                          ? "bg-slate-100 text-slate-600"
                          : "bg-rose-100 font-bold text-rose-600"
                      }`}
                    >
                      Est: {p.available}
                    </span>
                    <span className="text-sm font-black text-emerald-600">
                      {formatBRL(p.salePriceCents)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">{p.sku}</p>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full p-8 text-center text-sm text-slate-400">
                Nenhum produto encontrado para “{busca}”.
              </p>
            )}
          </div>
        </div>

        {/* Direita: carrinho + pagamento */}
        <div className="flex w-full flex-col rounded-xl border border-slate-200 bg-white shadow-xl lg:w-[400px]">
          <div className="flex items-center justify-between border-b border-slate-100 p-3">
            <h2 className="font-bold text-slate-700">
              Carrinho ({cart.length} {cart.length === 1 ? "item" : "itens"})
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCustomers(true)}
                className="rounded px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50"
              >
                {customer?.name ?? "Consumidor Final"}
              </button>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCart([]);
                    setSelectedKey(null);
                  }}
                  className="text-xs font-bold uppercase text-rose-500"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>

          <div className="min-h-[140px] flex-1 space-y-2 overflow-y-auto bg-slate-50 p-2">
            {cart.map((item) => (
              <div
                key={item.productId}
                onClick={() => setSelectedKey(item.productId)}
                className={`flex cursor-pointer items-center justify-between rounded-lg border bg-white p-2 shadow-sm ${
                  selectedKey === item.productId
                    ? "border-indigo-400 ring-2 ring-indigo-100"
                    : "border-slate-200"
                }`}
              >
                <div>
                  <p className="line-clamp-1 text-sm font-bold text-slate-700">
                    {item.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.quantity} × {formatBRL(item.unitPriceCents)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-slate-800">
                    {formatBRL(item.unitPriceCents * item.quantity)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(item.productId);
                    }}
                    aria-label={`Remover ${item.name}`}
                    className="text-slate-300 hover:text-rose-500"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {cart.length === 0 && (
              <p className="p-6 text-center text-sm text-slate-400">
                Toque nos produtos ou escaneie para adicionar.
              </p>
            )}
          </div>

          <div
            ref={payRef}
            tabIndex={-1}
            className="rounded-b-xl bg-slate-900 p-3 text-white"
          >
            <div className="mb-3 flex items-end justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">
                Total
              </span>
              <span className="text-3xl font-black text-emerald-400">
                {formatBRL(totalCents)}
              </span>
            </div>

            {paymentMethod === "PIX" && (
              <div className="mb-2 flex flex-col items-center">
                {pixPayload ? (
                  <button
                    type="button"
                    onClick={() => setPixOpen(true)}
                    className="rounded-lg bg-white p-2"
                    aria-label="Ampliar QR Code PIX"
                  >
                    <QRCode value={pixPayload} size={96} />
                  </button>
                ) : (
                  <p className="text-xs text-amber-300">
                    Configure a chave PIX da empresa para gerar o QR Code.
                  </p>
                )}
              </div>
            )}

            <div className="mb-2 grid grid-cols-4 gap-2">
              {PAY_BUTTONS.map((p) => (
                <button
                  key={p.method}
                  type="button"
                  onClick={() => setPaymentMethod(p.method)}
                  className={`rounded-lg border py-2 text-xs font-bold uppercase ${
                    paymentMethod === p.method
                      ? "border-emerald-500 bg-emerald-600"
                      : "border-slate-700 bg-slate-800 text-slate-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {paymentMethod === "CREDITO" && (
              <label className="mb-2 block">
                <span className="text-xs font-bold uppercase text-slate-400">
                  Parcelas
                </span>
                <select
                  value={installments}
                  onChange={(e) => setInstallments(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-white"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}× {formatBRL(Math.round(totalCents / n))}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {paymentMethod === "DINHEIRO" && (
              <div className="mb-2">
                <label htmlFor="pdv-recebido" className="block">
                  <span className="text-xs font-bold uppercase text-slate-400">
                    Recebido (R$)
                  </span>
                  <input
                    id="pdv-recebido"
                    value={receivedInput}
                    onChange={(e) => setReceivedInput(e.target.value)}
                    inputMode="decimal"
                    placeholder="0,00"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-right text-lg font-bold text-white"
                  />
                </label>
                {troco?.ok && (
                  <p className="mt-1 text-right text-sm font-bold text-emerald-400">
                    Troco: {formatBRL(troco.trocoCents)}
                  </p>
                )}
              </div>
            )}

            <div className="mb-2">
              <label htmlFor="pdv-desconto" className="block">
                <span className="text-xs font-bold uppercase text-slate-400">
                  Desconto do pedido (F4)
                </span>
                <input
                  id="pdv-desconto"
                  ref={discountRef}
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-right text-white"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => void finalizar()}
              disabled={busy || cart.length === 0 || !cash.open}
              className="w-full rounded-lg bg-emerald-600 py-3 text-lg font-black uppercase shadow-lg hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy
                ? "Processando..."
                : !cash.open
                  ? "Abra o caixa para vender"
                  : "Finalizar (F5)"}
            </button>
          </div>
        </div>
      </div>

      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
      {pixOpen && pixPayload && (
        <PixModal
          payload={pixPayload}
          totalLabel={formatBRL(totalCents)}
          onClose={() => setPixOpen(false)}
        />
      )}
      {cashModal && (
        <CashModal
          kind={cashModal}
          cash={cash}
          onClose={() => setCashModal(null)}
          onDone={(message) => {
            setCashModal(null);
            setFeedback({ type: "success", message });
            router.refresh();
          }}
        />
      )}
      {showCustomers && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowCustomers(false)}
          role="dialog"
          aria-label="Selecionar cliente"
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 font-bold text-slate-800">Cliente da venda</h2>
            <button
              type="button"
              onClick={() => {
                setCustomer(null);
                setShowCustomers(false);
              }}
              className="mb-2 w-full rounded-lg border border-slate-200 p-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Consumidor Final (sem cliente)
            </button>
            <div className="max-h-64 overflow-y-auto">
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCustomer(c);
                    setShowCustomers(false);
                  }}
                  className="w-full rounded-lg border border-slate-200 p-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-semibold text-slate-700">{c.name}</span>
                  {c.document && (
                    <span className="ml-2 text-xs text-slate-400">
                      {c.document}
                    </span>
                  )}
                </button>
              ))}
              {customers.length === 0 && (
                <p className="p-3 text-sm text-slate-400">
                  Nenhum cliente cadastrado.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
