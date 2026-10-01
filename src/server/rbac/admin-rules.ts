// Regra de negócio M1: o último ADMIN de um tenant não pode ser
// removido/rebaixado (tests/unit/admin-rules.test.ts).
// Usado nos hooks beforeRemoveMember/beforeUpdateMemberRole do Better Auth —
// protege TODOS os caminhos (UI e chamadas diretas à API).

export type MemberInfo = { userId: string; role: string };

export type RuleResult = { ok: true } | { ok: false; reason: string };

function countAdmins(members: MemberInfo[]): number {
  return members.filter((m) => m.role === "ADMIN").length;
}

export function canRemoveMember(
  members: MemberInfo[],
  targetUserId: string,
): RuleResult {
  const target = members.find((m) => m.userId === targetUserId);
  if (!target) return { ok: false, reason: "Membro não encontrado." };
  if (target.role === "ADMIN" && countAdmins(members) <= 1) {
    return {
      ok: false,
      reason: "O último administrador não pode ser removido.",
    };
  }
  return { ok: true };
}

export function canChangeRole(
  members: MemberInfo[],
  targetUserId: string,
  newRole: string,
): RuleResult {
  const target = members.find((m) => m.userId === targetUserId);
  if (!target) return { ok: false, reason: "Membro não encontrado." };
  if (target.role === newRole) return { ok: true };
  if (target.role === "ADMIN" && countAdmins(members) <= 1) {
    return {
      ok: false,
      reason: "O último administrador não pode ser rebaixado.",
    };
  }
  return { ok: true };
}
