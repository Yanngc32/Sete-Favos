import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

const LEN = 6;

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  status?: "error";
  disabled?: boolean;
  describedBy?: string;
}

/**
 * Código de 6 dígitos em 3 + 3 (estrutura de primitives/input-otp, Wensity, MIT).
 * Colar ou o preenchimento automático do SMS/teclado preenchem os 6 de uma vez.
 */
export function OtpInput({ value, onChange, onComplete, status, disabled, describedBy }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LEN }, (_, i) => value[i] ?? "");

  const focus = (i: number) => refs.current[Math.max(0, Math.min(LEN - 1, i))]?.focus();

  const fill = (from: number, raw: string) => {
    const incoming = raw.replace(/\D/g, "");
    if (!incoming) return;
    const next = (value.slice(0, from) + incoming).slice(0, LEN);
    onChange(next);
    focus(next.length);
    if (next.length === LEN) onComplete?.(next);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const at = digits[i] ? i : i - 1;
      if (at < 0) return;
      onChange(value.slice(0, at));
      focus(at);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focus(Math.min(i + 1, value.length));
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    fill(i, e.clipboardData.getData("text"));
  };

  const slot = (i: number) => (
    <input
      key={i}
      ref={(el) => {
        refs.current[i] = el;
      }}
      className="otp-s"
      value={digits[i]}
      data-filled={digits[i] ? "" : undefined}
      inputMode="numeric"
      autoComplete={i === 0 ? "one-time-code" : "off"}
      maxLength={i === 0 ? LEN : 1}
      aria-label={`Dígito ${i + 1} de ${LEN}`}
      aria-invalid={status === "error" || undefined}
      disabled={disabled}
      onKeyDown={(e) => onKey(i, e)}
      onPaste={(e) => onPaste(i, e)}
      onFocus={(e) => {
        // Sempre preenche em ordem: foco num slot à frente volta pro primeiro vazio.
        if (i > value.length) focus(value.length);
        else e.currentTarget.select();
      }}
      onChange={(e) => fill(Math.min(i, value.length), e.target.value)}
    />
  );

  return (
    <div
      className="otp"
      role="group"
      aria-label="Código de 6 dígitos"
      aria-describedby={describedBy}
      data-status={status}
      data-disabled={disabled ? "" : undefined}
    >
      <div className="otp-g">{[0, 1, 2].map(slot)}</div>
      <span className="otp-sep" aria-hidden />
      <div className="otp-g">{[3, 4, 5].map(slot)}</div>
    </div>
  );
}
