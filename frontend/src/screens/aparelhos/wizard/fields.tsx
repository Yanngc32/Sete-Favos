import {
  ChevronDown,
  CircleAlert,
  CircleHelp,
  ExternalLink,
  Eye,
  EyeOff,
  Hourglass,
  ShieldAlert,
  Smartphone,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Modal, ModalClose, ModalDescription, ModalTitle } from "@/components/Modal";
import type { Field } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isFirewall, isNotLocal, type Err } from "./model";

/** Campo de segredo: tipo senha com o olho de mostrar/esconder. */
export function SecretInput(props: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
  autoComplete?: string;
  mono?: boolean;
}) {
  const [show, setShow] = useState(false);
  const Icon = show ? EyeOff : Eye;
  return (
    <div className={cn("inp", props.invalid && "is-err")}>
      <input
        id={props.id}
        type={show ? "text" : "password"}
        className={cn(props.mono && show && "mono")}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        aria-required={props.required || undefined}
        autoComplete={props.autoComplete ?? "off"}
        spellCheck={false}
        autoCapitalize="off"
      />
      <button
        type="button"
        className="ibtn"
        aria-label={`${show ? "Esconder" : "Mostrar"} ${props.label}`}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
      >
        <span className="eye" key={String(show)}>
          <Icon className="i" aria-hidden />
        </span>
      </button>
    </div>
  );
}

const ids = (...list: (string | false | undefined | null)[]) => list.filter(Boolean).join(" ") || undefined;

/** Campo vindo da central (Field): texto, segredo ou select. */
export function FieldInput({
  id,
  field,
  value,
  onChange,
  invalid,
  errorId,
  required,
  mono,
  after,
}: {
  id: string;
  field: Field;
  after?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  /** id da mensagem de erro (do campo ou do formulário) */
  errorId?: string;
  required: boolean;
  mono?: boolean;
}) {
  const auto =
    field.secret ? (field.name === "password" ? "current-password" : "off")
    : /user|account|mail/.test(field.name) ? "username" : "off";
  return (
    <div className="fld">
      <label htmlFor={id}>
        {field.label}
        {!required && !field.options && <span className="muted"> · opcional</span>}
      </label>
      {field.options ? (
        <div className={cn("inp", invalid && "is-err")}>
          <select
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={errorId}
          >
            {required && !value && <option value="" disabled>Escolha…</option>}
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="i i-sm chev" aria-hidden />
        </div>
      ) : field.secret ? (
        <SecretInput
          id={id}
          value={value}
          onChange={onChange}
          label={field.label}
          invalid={invalid}
          describedBy={errorId}
          required={required}
          autoComplete={auto}
          mono={mono}
        />
      ) : (
        <div className={cn("inp", invalid && "is-err")}>
          <input
            id={id}
            className={cn(mono && "mono")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={errorId}
            aria-required={required || undefined}
            autoComplete={auto}
            spellCheck={false}
            autoCapitalize="off"
            inputMode={field.name === "username" ? "email" : undefined}
          />
        </div>
      )}
      {after}
    </div>
  );
}

export function TextField(props: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  mono?: boolean;
  inputMode?: "text" | "decimal" | "numeric";
  placeholder?: string;
  autoFocus?: boolean;
  /** Erro de fora (ex.: do formulário) que também descreve este campo. */
  invalid?: boolean;
  describedBy?: string;
}) {
  const errId = `${props.id}-err`;
  const hintId = `${props.id}-hint`;
  return (
    <div className="fld">
      <label htmlFor={props.id}>{props.label}</label>
      <div className={cn("inp", (props.error || props.invalid) && "is-err")}>
        <input
          id={props.id}
          className={cn(props.mono && "mono")}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          aria-invalid={!!props.error || props.invalid || undefined}
          aria-describedby={ids(props.error && errId, props.describedBy, props.hint && hintId)}
          inputMode={props.inputMode}
          placeholder={props.placeholder}
          autoFocus={props.autoFocus}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {props.error && <ErrHint id={errId}>{props.error}</ErrHint>}
      {props.hint && (
        <p className="hint" id={hintId}>
          {props.hint}
        </p>
      )}
    </div>
  );
}

export function ErrHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="hint err" id={id}>
      <CircleAlert className="i i-sm" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Aviso dentro do passo (.note). */
export function Note({
  tone,
  icon: Icon,
  title,
  children,
  actions,
  role,
  className,
}: {
  tone?: "warn" | "err";
  icon: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "alert" | "status";
  className?: string;
}) {
  return (
    <div className={cn("note", tone, className)} role={role}>
      <Icon className={cn("i", !title && "i-sm")} aria-hidden />
      <div className="nt">
        {title && <b>{title}</b>}
        {children && <span>{children}</span>}
        {actions && <div className="acts">{actions}</div>}
      </div>
    </div>
  );
}

/** Instruções do Firewall do Windows. */
export function FirewallHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalTitle render={<h3 />}>Liberar no Firewall do Windows</ModalTitle>
      <ModalDescription render={<p />}>No PC onde a colmeia roda:</ModalDescription>
      <ol className="ad-fw">
        <li>
          <span>
            Abra <b>Segurança do Windows</b> › <b>Firewall e proteção de rede</b> ›{" "}
            <b>Permitir um aplicativo pelo firewall</b>.
          </span>
        </li>
        <li>
          <span>
            Clique em <b>Alterar configurações</b> e procure o <b>Python</b> do Sete Favos (ou “casa”).
          </span>
        </li>
        <li>
          <span>
            Marque a coluna <b>Privada</b> e salve. Se não estiver na lista, use <b>Permitir outro aplicativo…</b>.
          </span>
        </li>
        <li>
          <span>Volte aqui e tente de novo.</span>
        </li>
      </ol>
      <div className="dlg-act">
        <ModalClose className="btn">Entendi</ModalClose>
      </div>
    </Modal>
  );
}

/**
 * Erro de busca/pareamento com o aviso certo: firewall, Xiaomi sem controle local,
 * teste da Tuya expirado ou genérico. `retry` vira "Tentar de novo".
 */
export function ErrNote({ err, retry, retryLabel = "Tentar de novo", extra }: {
  err: Err;
  retry?: () => void;
  retryLabel?: string;
  extra?: ReactNode;
}) {
  const [help, setHelp] = useState(false);
  const retryBtn = retry && (
    <button type="button" className="btn btn-sec btn-sm" onClick={retry}>
      {retryLabel}
    </button>
  );
  if (isFirewall(err)) {
    return (
      <>
        <Note
          tone="err"
          icon={ShieldAlert}
          role="alert"
          title="O PC não conseguiu falar com o aparelho."
          actions={
            <>
              <button type="button" className="btn btn-sec btn-sm btn-ico" onClick={() => setHelp(true)}>
                <CircleHelp className="i i-sm" aria-hidden />
                Como fazer
              </button>
              {retry && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
                  {retryLabel}
                </button>
              )}
            </>
          }
        >
          {err.code === "tv_sem_resposta" ? "A TV está ligada e no mesmo Wi-Fi? " : ""}
          Libere o integrador no Firewall do Windows.
        </Note>
        <FirewallHelp open={help} onOpenChange={setHelp} />
      </>
    );
  }
  if (isNotLocal(err)) {
    const [first, ...rest] = err.message.split(/(?<=\.)\s+/);
    return (
      <Note tone="warn" icon={WifiOff} role="alert" title={first} actions={(retryBtn || extra) && <>{retryBtn}{extra}</>}>
        {rest.join(" ")}
      </Note>
    );
  }
  if (err.code === "tuya_expirado") {
    return (
      <Note
        tone="err"
        icon={Hourglass}
        role="alert"
        title="O plano de teste da Tuya expirou."
        actions={
          <>
            <a className="btn btn-sec btn-sm btn-ico" href="https://iot.tuya.com" target="_blank" rel="noreferrer">
              <ExternalLink className="i i-sm" aria-hidden />
              Abrir iot.tuya.com
            </a>
            {retry && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
                {retryLabel}
              </button>
            )}
          </>
        }
      >
        Renove em iot.tuya.com e tente de novo.
      </Note>
    );
  }
  return (
    <Note tone="err" icon={err.code === "verificacao" ? Smartphone : CircleAlert} role="alert" actions={(retryBtn || extra) && <>{retryBtn}{extra}</>}>
      {err.message}
    </Note>
  );
}
