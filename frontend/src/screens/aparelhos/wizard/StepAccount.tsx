import { Check, ChevronDown, CircleHelp, ExternalLink, Hourglass, Lock, ShieldQuestion, Smartphone } from "lucide-react";
import type { Field, Vendor } from "@/lib/types";
import { ErrHint, ErrNote, FieldInput, Note } from "./fields";
import { isTuyaLike, wordmark, type Err } from "./model";

/** Erros que são "do formulário": ficam embaixo dos campos, ligados a eles. */
export const FIELD_ERRORS = new Set(["tuya_recusou", "campos_faltando", "regiao", "xiaomi_recusou"]);
export const ACC_ERR_ID = "acc-err";

export interface AccountProps {
  vendor: Vendor;
  /** Conta guardada (Tuya/Positivo): conectada e o usuário não pediu pra trocar. */
  connected: boolean;
  onSwap: () => void;
  onCancelSwap?: () => void;
  values: Record<string, string>;
  onValue: (name: string, value: string) => void;
  fieldErrs: Record<string, string>;
  err: Err | null;
  onRetry: () => void;
}

export function StepAccount(p: AccountProps) {
  const { vendor } = p;
  const saved = vendor.account_fields.length > 0;
  const fields: Field[] = (saved ? vendor.account_fields : vendor.transient_fields).filter((f) => !f.hidden);
  const formErr = p.err && FIELD_ERRORS.has(p.err.code ?? "") ? p.err : null;
  const blockErr = p.err && !formErr ? p.err : null;
  const helps = fields.map((f) => f.help).filter(Boolean) as string[];

  if (p.connected) {
    return (
      <div className="acct">
        <span className="who">
          <b>{wordmark(vendor.label).name}</b>
          <span>Chave guardada no cofre do Windows; nunca volta pra tela.</span>
        </span>
        <span className="chip ok">
          <Check className="i i-sm" aria-hidden />
          Conta conectada
        </span>
        <button type="button" className="btn-link" onClick={p.onSwap}>
          Trocar
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flds">
        {fields.map((f) => {
          const required = saved ? f.required : vendor.transient_required && f.required;
          const own = p.fieldErrs[f.name];
          const id = `acc-${f.name}`;
          return (
            <FieldInput
                key={f.name}
                id={id}
                field={f}
                value={p.values[f.name] ?? ""}
                onChange={(v) => p.onValue(f.name, v)}
                required={required}
                invalid={!!own || !!formErr}
                errorId={[own && `${id}-err`, formErr && ACC_ERR_ID].filter(Boolean).join(" ") || undefined}
                mono={/key|token/.test(f.name)}
                after={own && <ErrHint id={`${id}-err`}>{own}</ErrHint>}
              />
          );
        })}
        {formErr && <ErrHint id={ACC_ERR_ID}>{formErr.message}</ErrHint>}
        {!saved &&
          (helps.length ? helps : ["Usamos uma vez; a senha não fica salva."]).map((h) => (
            <p key={h} className="sec">
              <Lock className="i i-sm" aria-hidden />
              {h}
            </p>
          ))}
      </div>

      {isTuyaLike(vendor) && (
        <>
          <details className="how" open={!vendor.account_configured}>
            <summary>
              <CircleHelp className="i i-sm" aria-hidden />
              Como pegar no iot.tuya.com
              <ChevronDown className="i i-sm" aria-hidden />
            </summary>
            <ol>
              <li>
                <span>
                  Crie um projeto <b>Cloud</b> na sua região.
                </span>
              </li>
              <li>
                <span>
                  Em <b>Devices</b>, vincule o app {vendor.vendor === "positivo" ? "Positivo Casa Inteligente" : "Smart Life"} pelo QR.
                </span>
              </li>
              <li>
                <span>
                  Copie <b>Access ID</b> e <b>Access Secret</b>.
                </span>
              </li>
              <li>
                <span>Cole aqui e escolha a mesma região.</span>
              </li>
            </ol>
          </details>
          {blockErr?.code !== "tuya_expirado" && (
            <Note tone="warn" icon={Hourglass}>
              O teste gratuito da Tuya expira; renove pra adicionar aparelhos novos.
            </Note>
          )}
        </>
      )}

      {p.onCancelSwap && (
        <button type="button" className="btn-link" style={{ alignSelf: "flex-start" }} onClick={p.onCancelSwap}>
          Manter a conta conectada
        </button>
      )}

      {blockErr?.code === "captcha" && typeof blockErr.data?.image === "string" ? (
        <Note tone="warn" icon={ShieldQuestion} role="status" title="A Xiaomi pediu um captcha">
          <span className="capt">
            <span>{blockErr.message}</span>
            <img src={blockErr.data.image} alt="Captcha da Xiaomi" />
            <span className="inp">
              <input
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-label="Código da imagem"
                value={p.values.captcha ?? ""}
                onChange={(e) => p.onValue("captcha", e.target.value)}
              />
            </span>
          </span>
        </Note>
      ) : blockErr?.code === "verificacao" ? (
        <Note
          tone="warn"
          icon={Smartphone}
          role="status"
          title="A Xiaomi pediu verificação em 2 etapas"
          actions={
            typeof blockErr.data?.url === "string" && (
              <a className="btn btn-sec btn-sm btn-ico" href={blockErr.data.url} target="_blank" rel="noreferrer">
                <ExternalLink className="i i-sm" aria-hidden />
                Abrir a verificação
              </a>
            )
          }
        >
          Abra o link que a Xiaomi mandou por e-mail ou SMS e confirme este acesso. Depois toque em Já confirmei.
        </Note>
      ) : (
        blockErr && <ErrNote err={blockErr} retry={p.onRetry} />
      )}
    </>
  );
}
