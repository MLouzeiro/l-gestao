// Leitor de código de barras (USB HID) na tela de vendas — regras puras.
// O leitor digita o código + Enter no campo; aqui só resolvemos código → produto.

export type ScanProduct = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  salePriceCents: number;
};

export type ScanResolution =
  | { status: "found"; product: ScanProduct }
  | { status: "not_found"; code: string };

export function resolveProductByCode(
  products: ScanProduct[],
  input: string,
): ScanResolution | null {
  const code = input.trim();
  if (!code) return null;

  const byBarcode = products.find((p) => p.barcode?.trim() === code);
  if (byBarcode) return { status: "found", product: byBarcode };

  const lower = code.toLowerCase();
  const bySku = products.find((p) => p.sku.toLowerCase() === lower);
  if (bySku) return { status: "found", product: bySku };

  return { status: "not_found", code };
}
