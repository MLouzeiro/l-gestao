import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/server/auth";
import { AceitarConviteForm } from "@/components/convite/aceitar-convite-form";

export default async function ConvitePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });

  if (!id) {
    return (
      <Mensagem
        titulo="Convite inválido"
        texto="O link do convite está incompleto. Peça um novo convite à administração da empresa."
      />
    );
  }

  if (!session) {
    return (
      <Mensagem
        titulo="Faça login para aceitar"
        texto="Entre com o seu usuário e depois abra o link do convite novamente."
        acao={<Link href="/login" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Ir para o login</Link>}
      />
    );
  }

  type ConviteInfo = {
    id: string;
    email: string;
    role: string;
    organizationName: string;
    inviterEmail: string;
  };
  let invitation: ConviteInfo | null = null;
  let erro: string | null = null;

  try {
    const inv = await auth.api.getInvitation({
      headers: await headers(),
      query: { id },
    });
    invitation = {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      organizationName: inv.organizationName,
      inviterEmail: inv.inviterEmail,
    };
  } catch {
    erro = "Convite não encontrado, já aceitado ou expirado.";
  }

  if (erro || !invitation) {
    return (
      <Mensagem
        titulo="Convite indisponível"
        texto={erro ?? "Convite não encontrado."}
        acao={<Link href="/empresas" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Voltar</Link>}
      />
    );
  }

  const emailConfere = invitation.email.toLowerCase() === session.user.email.toLowerCase();

  return (
    <Mensagem
      titulo="Você foi convidado"
      texto={`${invitation.inviterEmail} convidou ${invitation.email} para a empresa "${invitation.organizationName}" como ${invitation.role}.${
        emailConfere
          ? ""
          : ` Atenção: o convite é para outro e-mail (você está logado como ${session.user.email}).`
      }`}
      acao={
        <AceitarConviteForm invitationId={invitation.id} bloqueado={!emailConfere} />
      }
    />
  );
}

function Mensagem({
  titulo,
  texto,
  acao,
}: {
  titulo: string;
  texto: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-700">
          E
        </div>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">{titulo}</h1>
        <p className="mt-2 text-sm text-slate-600">{texto}</p>
        {acao && <div className="mt-5 flex justify-center">{acao}</div>}
      </div>
    </div>
  );
}
