"use client";

import QRCode from "react-qr-code";

// QR PIX em tela cheia (reaproveitado do l-estoque — o operador mostra a tela
// para o cliente fotografar).

export function PixModal({
  payload,
  totalLabel,
  onClose,
}: {
  payload: string;
  totalLabel: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-black/95 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="QR Code PIX"
    >
      <p className="text-3xl font-black text-white">{totalLabel}</p>
      <div className="mt-8 rounded-xl bg-white p-4 shadow-2xl">
        <QRCode value={payload} size={300} />
      </div>
      <p className="mt-8 animate-pulse text-slate-400">
        Toque em qualquer lugar para fechar
      </p>
    </div>
  );
}
