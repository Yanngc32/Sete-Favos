import { useEffect, useRef, useState } from "react";
import { GroupSession } from "./GroupEditor";
import { closeGroupDialog, useGroupDialog, type GroupDialogRequest } from "./groupDialog";

/**
 * Monta o dialog de grupo quando alguém chama openGroupDialog(). Uma abertura = uma sessão (o formulário nasce do
 * zero); fechar toca a animação de saída e só depois desmonta.
 */
export function GroupDialogHost() {
  const request = useGroupDialog();
  const seq = useRef(0);
  const [session, setSession] = useState<{ id: number; request: GroupDialogRequest } | null>(null);

  useEffect(() => {
    if (request) setSession((s) => (s?.request === request ? s : { id: ++seq.current, request }));
  }, [request]);

  if (!session) return null;
  return (
    <GroupSession
      key={session.id}
      request={session.request}
      active={request === session.request}
      onClose={closeGroupDialog}
      onGone={() => setSession((s) => (s?.id === session.id ? null : s))}
    />
  );
}
