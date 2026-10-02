"use client";

// Ajuda dos atalhos do PDV (F1) — teclado de balcão.

const ATALHOS: { key: string; label: string }[] = [
  { key: "F1", label: "Abrir/fechar esta ajuda" },
  { key: "F2", label: "Buscar produto / código de barras" },
  { key: "F3", label: "Informar quantidade" },
  { key: "F4", label: "Desconto do pedido" },
  { key: "F5", label: "Finalizar venda" },
  { key: "F6", label: "Selecionar cliente" },
  { key: "F7", label: "Forma de pagamento" },
  { key: "F8", label: "Abrir cupom da última venda" },
  { key: "F9", label: "Remover item selecionado do carrinho" },
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Atalhos do PDV"
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">Atalhos do PDV</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-50"
          >
            Fechar
          </button>
        </div>
        <ul className="space-y-2">
          {ATALHOS.map((a) => (
            <li key={a.key} className="flex items-center gap-3 text-sm">
              <kbd className="rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-xs font-bold text-slate-700">
                {a.key}
              </kbd>
              <span className="text-slate-600">{a.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
