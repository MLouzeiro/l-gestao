"use client";

import { useMemo, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  _criarCategoria,
  _criarFornecedor,
  _criarMarca,
  _excluirProduto,
  _salvarProduto,
  type ProdutoFormState,
} from "@/actions/produtos";

type Categoria = { id: string; name: string; parentId: string | null };
type Marca = { id: string; name: string };
type Unidade = { key: string; name: string; decimals: number };
type Fornecedor = { id: string; name: string; document: string | null; phone: string | null };
type KitComponentUI = { componentId: string; name: string; sku: string; quantity: number };

type ProdutoUI = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  barcode: string | null;
  salePrice: string;
  costPrice: string;
  minStock: string;
  maxStock: string | null;
  status: "ACTIVE" | "INACTIVE" | "DISCONTINUED";
  isKit: boolean;
  trackBatch: boolean;
  requiresPrescription: boolean;
  parentId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  unitId: string | null;
  unitKey: string | null;
  margin: number | null;
  kitComponents: KitComponentUI[];
};

type Props = {
  produtos: ProdutoUI[];
  categorias: Categoria[];
  marcas: Marca[];
  unidades: Unidade[];
  fornecedores: Fornecedor[];
  canManage: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  DISCONTINUED: "Descontinuado",
};

function Botao({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "danger";
}) {
  const { pending } = useFormStatus();
  const cor =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700"
      : variant === "ghost"
        ? "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
        : "bg-indigo-600 hover:bg-indigo-700";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60 ${cor}`}
    >
      {pending ? "..." : children}
    </button>
  );
}

function campo(label: string, children: React.ReactNode, span = "") {
  return (
    <label className={`text-xs font-medium text-slate-500 ${span}`}>
      {label}
      {children}
    </label>
  );
}

const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800";

function opcoesCategorias(cats: Categoria[]): { id: string; label: string }[] {
  const filhos = new Map<string | null, Categoria[]>();
  for (const c of cats) {
    const list = filhos.get(c.parentId) ?? [];
    list.push(c);
    filhos.set(c.parentId, list);
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of filhos.get(parent) ?? []) {
      out.push({ id: c.id, label: `${"— ".repeat(depth)}${c.name}` });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function NovaCategoria() {
  const [state, formAction] = useActionState<ProdutoFormState, FormData>(
    _criarCategoria,
    null,
  );
  const [aberto, setAberto] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
      >
        + nova categoria
      </button>
      {aberto && (
        <form action={formAction} className="mt-2 flex items-end gap-2">
          <input name="name" required placeholder="Nome" className={`${inputCls} flex-1`} />
          <Botao>Salvar</Botao>
          {state?.error && (
            <span className="text-xs text-red-600">{state.error}</span>
          )}
          {state?.ok && (
            <span className="text-xs text-emerald-600">{state.message}</span>
          )}
        </form>
      )}
    </div>
  );
}

function NovaMarca() {
  const [state, formAction] = useActionState<ProdutoFormState, FormData>(
    _criarMarca,
    null,
  );
  const [aberto, setAberto] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
      >
        + nova marca
      </button>
      {aberto && (
        <form action={formAction} className="mt-2 flex items-end gap-2">
          <input name="name" required placeholder="Nome" className={`${inputCls} flex-1`} />
          <Botao>Salvar</Botao>
          {state?.error && (
            <span className="text-xs text-red-600">{state.error}</span>
          )}
          {state?.ok && (
            <span className="text-xs text-emerald-600">{state.message}</span>
          )}
        </form>
      )}
    </div>
  );
}

function FormExcluir({ id, nome }: { id: string; nome: string }) {
  const [state, formAction] = useActionState<ProdutoFormState, FormData>(
    _excluirProduto,
    null,
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Excluir o produto "${nome}"? O histórico é preservado.`))
          e.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="id" value={id} />
      <Botao variant="danger">Excluir</Botao>
      {state?.error && (
        <span className="ml-2 text-xs text-red-600">{state.error}</span>
      )}
    </form>
  );
}

type LinhaKit = { componentId: string; quantity: string };

function FormProduto({
  produto,
  produtos,
  categorias,
  marcas,
  unidades,
  onCancelar,
}: {
  produto: ProdutoUI | null;
  produtos: ProdutoUI[];
  categorias: Categoria[];
  marcas: Marca[];
  unidades: Unidade[];
  onCancelar: () => void;
}) {
  const [state, formAction] = useActionState<ProdutoFormState, FormData>(
    _salvarProduto,
    null,
  );
  const [isKit, setIsKit] = useState(produto?.isKit ?? false);
  const [linhas, setLinhas] = useState<LinhaKit[]>(
    produto?.kitComponents.length
      ? produto.kitComponents.map((c) => ({
          componentId: c.componentId,
          quantity: String(c.quantity),
        }))
      : [{ componentId: "", quantity: "1" }],
  );

  const opcoesCat = useMemo(() => opcoesCategorias(categorias), [categorias]);
  const componentesDisponiveis = produtos.filter(
    (p) => p.id !== produto?.id,
  );

  if (state?.ok) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-800">{state.message}</p>
        <button
          type="button"
          onClick={onCancelar}
          className="mt-2 text-xs font-medium text-emerald-700 underline"
        >
          Voltar à lista
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">
          {produto ? `Editar: ${produto.name}` : "Novo produto"}
        </h2>
        <button
          type="button"
          onClick={onCancelar}
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          Cancelar
        </button>
      </div>

      {produto && <input type="hidden" name="id" value={produto.id} />}

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
        {campo(
          "SKU *",
          <input name="sku" required defaultValue={produto?.sku ?? ""} placeholder="SKU-001" className={`${inputCls} uppercase`} />,
        )}
        {campo(
          "Nome *",
          <input name="name" required defaultValue={produto?.name ?? ""} maxLength={200} className={inputCls} />,
          "col-span-2",
        )}
        {campo(
          "Preço venda (R$) *",
          <input name="salePrice" required inputMode="decimal" defaultValue={produto ? Number(produto.salePrice).toFixed(2).replace(".", ",") : ""} placeholder="19,90" className={inputCls} />,
        )}
        {campo(
          "Custo (R$)",
          <input name="costPrice" inputMode="decimal" defaultValue={produto && Number(produto.costPrice) > 0 ? Number(produto.costPrice).toFixed(2).replace(".", ",") : ""} placeholder="10,00" className={inputCls} />,
        )}
        {campo(
          "Status",
          <select name="status" defaultValue={produto?.status ?? "ACTIVE"} className={inputCls}>
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
            <option value="DISCONTINUED">Descontinuado</option>
          </select>,
        )}

        {campo(
          "Categoria",
          <>
            <select name="categoryId" defaultValue={produto?.categoryId ?? ""} className={inputCls}>
              <option value="">— sem categoria —</option>
              {opcoesCat.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <NovaCategoria />
          </>,
          "col-span-2",
        )}
        {campo(
          "Marca",
          <>
            <select name="brandId" defaultValue={produto?.brandId ?? ""} className={inputCls}>
              <option value="">— sem marca —</option>
              {marcas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <NovaMarca />
          </>,
          "col-span-2",
        )}
        {campo(
          "Unidade",
          <select name="unitKey" defaultValue={produto?.unitKey ?? "UN"} className={inputCls}>
            <option value="">—</option>
            {unidades.map((u) => (
              <option key={u.key} value={u.key}>
                {u.name}
              </option>
            ))}
          </select>,
        )}
        {campo(
          "Código de barras",
          <input name="barcode" defaultValue={produto?.barcode ?? ""} placeholder="789..." className={inputCls} />,
        )}

        {campo(
          "Estoque mínimo",
          <input name="minStock" inputMode="decimal" defaultValue={produto ? Number(produto.minStock) : ""} placeholder="0" className={inputCls} />,
        )}
        {campo(
          "Estoque máximo",
          <input name="maxStock" inputMode="decimal" defaultValue={produto?.maxStock ? Number(produto.maxStock) : ""} placeholder="—" className={inputCls} />,
        )}
        {campo(
          "Produto pai (variação)",
          <select name="parentId" defaultValue={produto?.parentId ?? ""} className={inputCls}>
            <option value="">— nenhum (produto comum) —</option>
            {componentesDisponiveis
              .filter((p) => !p.isKit)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
          </select>,
          "col-span-2",
        )}
        {campo(
          "Descrição",
          <textarea name="description" rows={2} defaultValue={produto?.description ?? ""} className={inputCls} />,
          "col-span-2",
        )}

        <div className="col-span-2 flex flex-col gap-2 pt-4 text-xs font-medium text-slate-600 md:col-span-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="trackBatch"
              defaultChecked={produto?.trackBatch ?? false}
              className="h-4 w-4"
            />
            Controla lote/validade
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="requiresPrescription"
              defaultChecked={produto?.requiresPrescription ?? false}
              className="h-4 w-4"
            />
            Exige prescrição (saúde)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="isKit"
              defaultChecked={produto?.isKit ?? false}
              onChange={(e) => setIsKit(e.target.checked)}
              className="h-4 w-4"
            />
            É um kit (compõe outros produtos)
          </label>
        </div>
      </div>

      {isKit && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700">
              Componentes do kit
            </h3>
            <button
              type="button"
              onClick={() =>
                setLinhas((l) => [...l, { componentId: "", quantity: "1" }])
              }
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              + adicionar componente
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {linhas.map((linha, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  name="componentId"
                  value={linha.componentId}
                  onChange={(e) =>
                    setLinhas((l) =>
                      l.map((x, j) =>
                        j === i ? { ...x, componentId: e.target.value } : x,
                      ),
                    )
                  }
                  className={`${inputCls} flex-1`}
                >
                  <option value="">Selecione o produto...</option>
                  {componentesDisponiveis.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
                <input
                  name="componentQty"
                  value={linha.quantity}
                  onChange={(e) =>
                    setLinhas((l) =>
                      l.map((x, j) =>
                        j === i ? { ...x, quantity: e.target.value } : x,
                      ),
                    )
                  }
                  inputMode="decimal"
                  className={`${inputCls} w-24`}
                />
                <button
                  type="button"
                  onClick={() => setLinhas((l) => l.filter((_, j) => j !== i))}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  remover
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Botao>{produto ? "Salvar alterações" : "Cadastrar produto"}</Botao>
        {state?.error && (
          <span className="text-xs font-medium text-red-600">{state.error}</span>
        )}
      </div>
    </form>
  );
}

function FormFornecedor() {
  const [state, formAction] = useActionState<ProdutoFormState, FormData>(
    _criarFornecedor,
    null,
  );
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        + Novo fornecedor
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-slate-500">
        Nome *
        <input name="name" required className={`${inputCls} w-48`} />
      </label>
      <label className="text-xs font-medium text-slate-500">
        CPF/CNPJ
        <input name="document" className={`${inputCls} w-40`} />
      </label>
      <label className="text-xs font-medium text-slate-500">
        Telefone
        <input name="phone" className={`${inputCls} w-36`} />
      </label>
      <label className="text-xs font-medium text-slate-500">
        E-mail
        <input name="email" type="email" className={`${inputCls} w-48`} />
      </label>
      <Botao>Salvar</Botao>
      <button
        type="button"
        onClick={() => setAberto(false)}
        className="text-xs text-slate-500 hover:text-slate-700"
      >
        cancelar
      </button>
      {state?.error && (
        <span className="text-xs text-red-600">{state.error}</span>
      )}
      {state?.ok && (
        <span className="text-xs text-emerald-600">{state.message}</span>
      )}
    </form>
  );
}

export function ProdutosClient(props: Props) {
  const { produtos, canManage, fornecedores } = props;
  const [modo, setModo] = useState<"lista" | "form">("lista");
  const [editando, setEditando] = useState<ProdutoUI | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("ALL");

  const filtrados = produtos.filter((p) => {
    const q = busca.trim().toLowerCase();
    const bate =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode ?? "").includes(q);
    const st = filtroStatus === "ALL" || p.status === filtroStatus;
    return bate && st;
  });

  if (modo === "form") {
    return (
      <div className="space-y-6">
        <FormProduto
          key={editando?.id ?? "novo"}
          produto={editando}
          produtos={produtos}
          categorias={props.categorias}
          marcas={props.marcas}
          unidades={props.unidades}
          onCancelar={() => {
            setEditando(null);
            setModo("lista");
          }}
        />
        {editando && canManage && (
          <div className="flex justify-end">
            <FormExcluir id={editando.id} nome={editando.name} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setEditando(null);
              setModo("form");
            }}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Novo produto
          </button>
        )}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, SKU ou código de barras..."
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm"
        >
          <option value="ALL">Todos os status</option>
          <option value="ACTIVE">Ativos</option>
          <option value="INACTIVE">Inativos</option>
          <option value="DISCONTINUED">Descontinuados</option>
        </select>
        <span className="text-xs text-slate-500">
          {filtrados.length} de {produtos.length}
        </span>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        {filtrados.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            {produtos.length === 0
              ? "Nenhum produto cadastrado ainda."
              : "Nenhum produto corresponde à busca."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Produto</th>
                  <th className="px-4 py-2 font-medium">Categoria / Marca</th>
                  <th className="px-4 py-2 text-right font-medium">Custo</th>
                  <th className="px-4 py-2 text-right font-medium">Venda</th>
                  <th className="px-4 py-2 text-right font-medium">Margem</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtrados.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {p.sku}
                      {p.isKit && (
                        <span className="ml-1 rounded bg-indigo-50 px-1 py-0.5 text-[10px] font-semibold text-indigo-600">
                          KIT
                        </span>
                      )}
                      {p.trackBatch && (
                        <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-600">
                          LOTE
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-800">{p.name}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {p.categoryName ?? "—"}
                      {p.brandName && ` · ${p.brandName}`}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      R$ {Number(p.costPrice).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-slate-800">
                      R$ {Number(p.salePrice).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {p.margin != null ? `${p.margin}%` : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          p.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700"
                            : p.status === "INACTIVE"
                              ? "bg-slate-100 text-slate-500"
                              : "bg-rose-50 text-rose-600"
                        }`}
                      >
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {canManage ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditando(p);
                                setModo("form");
                              }}
                              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                            >
                              Editar
                            </button>
                            <FormExcluir id={p.id} nome={p.name} />
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">
            Fornecedores
          </h2>
          <div className="mt-3 space-y-2">
            <FormFornecedor />
            {fornecedores.length === 0 ? (
              <p className="text-xs text-slate-500">
                Nenhum fornecedor cadastrado.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {fornecedores.map((f) => (
                  <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-700">{f.name}</span>
                    <span className="text-xs text-slate-400">
                      {f.document ?? "sem documento"}
                      {f.phone && ` · ${f.phone}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
