// Regras puras de unidades (E3) — sem banco, sem sessão.
// Hierarquia MATRIZ → FILIAL → POSTO, estoque-alvo por unidade e
// expansão de acesso por herança (warehouse_members).

export type UnitType = "MATRIZ" | "FILIAL" | "POSTO";

export type UnitNode = {
  id: string;
  parentId: string | null;
  type: UnitType;
};

export type UnitTarget = {
  minQty: number | null;
  maxQty: number | null;
  reorderPoint: number | null;
};

/** Erro de domínio com mensagem pt-BR (a action devolve como { error }). */
export class UnitError extends Error {}

const UNIT_TYPES: readonly UnitType[] = ["MATRIZ", "FILIAL", "POSTO"];

export function isUnitType(v: string): v is UnitType {
  return (UNIT_TYPES as readonly string[]).includes(v);
}

/** Coleta o id de todos os descendentes (filhos, netos…) de `rootId`. */
function descendantIds(nodes: UnitNode[], rootId: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const n of nodes) {
    const kids = byParent.get(n.parentId ?? "") ?? [];
    kids.push(n.id);
    byParent.set(n.parentId ?? "", kids);
  }
  const out = new Set<string>();
  const stack = [...(byParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(byParent.get(id) ?? []));
  }
  return out;
}

/**
 * Valida a colocação de uma unidade na hierarquia:
 * - MATRIZ é sempre raiz (sem pai);
 * - POSTO é folha (não pode ter filhas);
 * - sem auto-referência e sem ciclos;
 * - pai precisa existir.
 */
export function assertUnitHierarchy(input: {
  selfId?: string;
  parentId: string | null;
  type: UnitType;
  nodes: UnitNode[];
}): void {
  const { selfId, parentId, type, nodes } = input;

  if (type === "MATRIZ" && parentId !== null) {
    throw new UnitError("A matriz não pode ter unidade pai.");
  }
  if (parentId !== null && parentId === selfId) {
    throw new UnitError("Uma unidade não pode ser pai de si mesma.");
  }
  if (parentId !== null) {
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) {
      throw new UnitError("Unidade pai não encontrada.");
    }
    if (parent.type === "POSTO") {
      throw new UnitError("Uma unidade do tipo POSTO não pode ter filhas.");
    }
    if (selfId) {
      const descendentes = descendantIds(nodes, selfId);
      if (descendentes.has(parentId)) {
        throw new UnitError(
          "A hierarquia formaria um ciclo: o pai é descendente da unidade.",
        );
      }
    }
  }
}

/** Valida faixas de estoque-alvo (mínimo, máximo, ponto de reposição). */
export function validateUnitTarget(target: UnitTarget): void {
  const { minQty, maxQty, reorderPoint } = target;
  for (const v of [minQty, maxQty, reorderPoint]) {
    if (v !== null && v < 0) {
      throw new UnitError("Valores de estoque-alvo não podem ser negativos.");
    }
  }
  if (minQty !== null && maxQty !== null && minQty > maxQty) {
    throw new UnitError("O mínimo não pode ser maior que o máximo.");
  }
  if (reorderPoint !== null && maxQty !== null && reorderPoint > maxQty) {
    throw new UnitError(
      "O ponto de reposição não pode ser maior que o máximo.",
    );
  }
}

/**
 * Expande o acesso do usuário às unidades:
 * - sem vínculos em warehouse_members → acesso amplo (todas);
 * - com vínculos → as próprias unidades + todos os descendentes (herança).
 */
export function expandMemberAccess(
  nodes: UnitNode[],
  memberOfIds: readonly string[],
): string[] {
  if (memberOfIds.length === 0) {
    return nodes.map((n) => n.id);
  }
  const allowed = new Set<string>();
  for (const id of memberOfIds) {
    if (!nodes.some((n) => n.id === id)) continue;
    allowed.add(id);
    for (const d of descendantIds(nodes, id)) allowed.add(d);
  }
  return [...allowed];
}

/**
 * Escolhe a unidade operacional padrão (ex.: depósito do PDV):
 * a marcada como default; sem default, a de menor código (determinístico).
 */
export function selectDefaultWarehouse(
  rows: readonly { id: string; isDefault: boolean; code: string }[],
): string | null {
  if (rows.length === 0) return null;
  const def = rows.find((r) => r.isDefault);
  if (def) return def.id;
  return [...rows].sort((a, b) => a.code.localeCompare(b.code))[0]!.id;
}
