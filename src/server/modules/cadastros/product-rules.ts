// Regras puras de produtos/cadastros (TDD: tests/unit/product-rules.test.ts).
// Nenhum acesso a banco aqui — só normalização, validação, margem e ciclos.

export type RuleResult = { ok: true } | { ok: false; reason: string };

export function normalizeSku(sku: string): string {
  return (sku ?? "").trim().toUpperCase();
}

export function normalizeDocument(doc: string): string {
  return (doc ?? "").replace(/\D/g, "");
}

/** CPF = 11 dígitos, CNPJ = 14; vazio é válido (campo opcional). */
export function validateDocument(doc: string | null | undefined): RuleResult {
  if (!doc || !doc.trim()) return { ok: true };
  const d = normalizeDocument(doc);
  if (d.length !== 11 && d.length !== 14) {
    return {
      ok: false,
      reason: "Documento inválido (CPF: 11 dígitos, CNPJ: 14 dígitos).",
    };
  }
  return { ok: true };
}

export type ProductInput = {
  sku: string;
  name: string;
  /** centavos (inteiro) */
  salePriceCents: number;
  /** centavos (inteiro), opcional */
  costPriceCents?: number;
  minStock?: number;
  maxStock?: number | null;
  barcode?: string | null;
};

export function validateProductInput(input: ProductInput): RuleResult {
  const sku = normalizeSku(input.sku);
  if (sku.length < 2 || sku.length > 64) {
    return { ok: false, reason: "SKU deve ter de 2 a 64 caracteres." };
  }
  if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(sku)) {
    return {
      ok: false,
      reason: "SKU inválido: use letras, números e apenas . _ / -",
    };
  }

  const name = (input.name ?? "").trim();
  if (name.length < 2 || name.length > 200) {
    return { ok: false, reason: "Nome deve ter de 2 a 200 caracteres." };
  }

  if (!Number.isInteger(input.salePriceCents) || input.salePriceCents < 0) {
    return { ok: false, reason: "Preço de venda inválido." };
  }
  if (
    input.costPriceCents !== undefined &&
    (!Number.isInteger(input.costPriceCents) || input.costPriceCents < 0)
  ) {
    return { ok: false, reason: "Custo inválido." };
  }

  const min = input.minStock ?? 0;
  if (!Number.isFinite(min) || min < 0) {
    return { ok: false, reason: "Estoque mínimo inválido." };
  }
  if (input.maxStock != null) {
    if (!Number.isFinite(input.maxStock) || input.maxStock < 0) {
      return { ok: false, reason: "Estoque máximo inválido." };
    }
    if (input.maxStock < min) {
      return {
        ok: false,
        reason: "Estoque máximo não pode ser menor que o mínimo.",
      };
    }
  }

  if (input.barcode) {
    const b = input.barcode.trim();
    if (!/^\d{8,14}$/.test(b)) {
      return {
        ok: false,
        reason: "Código de barras inválido (8 a 14 dígitos).",
      };
    }
  }
  return { ok: true };
}

/**
 * Margem % sobre o custo — espelho da coluna gerada do banco
 * ((sale - cost) / NULLIF(cost, 0)) * 100. Custo 0 → null.
 */
export function calcMarginPercent(
  costCents: number,
  saleCents: number,
): number | null {
  if (!Number.isFinite(costCents) || costCents <= 0) return null;
  const pct = ((saleCents - costCents) / costCents) * 100;
  return Math.round(pct * 100) / 100;
}

export type KitComponent = {
  componentId: string;
  quantity: number;
};

export function validateKitComponents(
  kitId: string,
  components: KitComponent[],
): RuleResult {
  if (components.length === 0) {
    return { ok: false, reason: "O kit precisa de ao menos 1 componente." };
  }
  const seen = new Set<string>();
  for (const c of components) {
    if (!c.componentId) {
      return { ok: false, reason: "Componente inválido." };
    }
    if (c.componentId === kitId) {
      return { ok: false, reason: "O kit não pode ser componente de si mesmo." };
    }
    if (seen.has(c.componentId)) {
      return { ok: false, reason: "Componente duplicado no kit." };
    }
    seen.add(c.componentId);
    if (!Number.isFinite(c.quantity) || c.quantity <= 0) {
      return {
        ok: false,
        reason: "Quantidade do componente deve ser maior que zero.",
      };
    }
  }
  return { ok: true };
}

export type KitEdge = { kitId: string; componentId: string };

/**
 * Ciclo no grafo de kits (A compõe B e B compõe A). DFS 3-cores.
 * Auto-loop (kit = componente) também conta como ciclo.
 */
export function hasKitCycle(edges: KitEdge[]): boolean {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    const list = graph.get(e.kitId) ?? [];
    list.push(e.componentId);
    graph.set(e.kitId, list);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  const dfs = (node: string): boolean => {
    color.set(node, GRAY);
    for (const next of graph.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  };

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE && dfs(node)) return true;
  }
  return false;
}

export function validateVariation(
  productId: string,
  parentId: string | null | undefined,
  isKit: boolean,
): RuleResult {
  if (!parentId) return { ok: true };
  if (parentId === productId) {
    return { ok: false, reason: "O produto não pode ser pai de si mesmo." };
  }
  if (isKit) {
    return { ok: false, reason: "Kit não pode ser variação de outro produto." };
  }
  return { ok: true };
}

/**
 * Detecta ciclo na cadeia de variações ao reapontar `productId` para
 * `newParentId`: caminha dos pais atuais até a raiz; se encontrar o
 * próprio productId, o novo apontamento fecha um ciclo.
 */
export function hasParentCycle(
  parents: Map<string, string | null>,
  productId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  let current: string | null = newParentId;
  const guard = new Set<string>();
  while (current) {
    if (current === productId) return true;
    if (guard.has(current)) return true; // cadeia já circular (defesa)
    guard.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}
