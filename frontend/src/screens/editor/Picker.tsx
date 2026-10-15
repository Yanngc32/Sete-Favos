// Seletor do editor: lista suspensa no desktop (Base UI Select), bottom sheet no celular.
import { Dialog } from "@base-ui/react/dialog";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown, WifiOff, X, type LucideIcon } from "lucide-react";
import { Fragment, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/screens/automacoes/media";

export interface PickOpt {
  value: string;
  label: string;
  short?: string;
  sub?: string;
  Icon?: LucideIcon;
  off?: boolean;
  group?: string;
}

interface PickerProps {
  /** Rótulo (título do sheet e nome acessível quando não há labelledBy). */
  label: string;
  /** id do rótulo visível (cabeçalho da coluna). */
  labelledBy?: string;
  value: string | null | undefined;
  options: PickOpt[];
  onChange: (v: string) => void;
  placeholder?: string;
  error?: boolean;
  describedBy?: string;
  /** Ícone quando a opção não tem o seu. */
  Icon?: LucideIcon;
  disabled?: boolean;
  className?: string;
  /** Data attribute para focar depois de adicionar. */
  focusKey?: string;
}

function groupsOf(options: PickOpt[]) {
  const groups: { name: string | undefined; items: PickOpt[] }[] = [];
  for (const o of options) {
    const last = groups[groups.length - 1];
    if (last && last.name === o.group) last.items.push(o);
    else groups.push({ name: o.group, items: [o] });
  }
  return groups;
}

export function Picker(props: PickerProps) {
  const mobile = useIsMobile();
  return mobile ? <SheetPicker {...props} /> : <MenuPicker {...props} />;
}

function Face({ cur, placeholder, Icon, vid, chevron = true }: { cur?: PickOpt; placeholder: string; Icon?: LucideIcon; vid: string; chevron?: boolean }) {
  const I = cur?.Icon ?? Icon;
  return (
    <>
      {I && <I className="i i-sm" aria-hidden />}
      <span className={cn("v", !cur && "ph-t")} id={vid}>
        {cur ? cur.label : placeholder}
      </span>
      {chevron && <ChevronsUpDown className="i i-sm" aria-hidden />}
    </>
  );
}

function MenuPicker({ label, labelledBy, value, options, onChange, placeholder = "Escolha", error, describedBy, Icon, disabled, className, focusKey }: PickerProps) {
  const vid = useId();
  const cur = options.find((o) => o.value === value);
  return (
    <Select.Root
      value={value || null}
      onValueChange={(v) => v != null && onChange(String(v))}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      disabled={disabled}
    >
      <Select.Trigger
        className={cn("pick", error && "is-err", className)}
        aria-labelledby={labelledBy ? `${labelledBy} ${vid}` : undefined}
        aria-label={labelledBy ? undefined : label}
        aria-describedby={describedBy}
        aria-invalid={error || undefined}
        data-fk={focusKey}
      >
        <Face cur={cur} placeholder={placeholder} Icon={Icon} vid={vid} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="mk pk-pos" alignItemWithTrigger={false} align="start" sideOffset={4}>
          <Select.Popup className="pk-pop">
            <Select.List className="pk-l">
              {groupsOf(options).map((g, gi) => (
                <Fragment key={g.name ?? gi}>
                  {g.name && options.some((o) => o.group !== g.name) ? (
                    <Select.Group className="pk-g">
                      <Select.GroupLabel className="pk-gl">{g.name}</Select.GroupLabel>
                      {g.items.map((o) => (
                        <MenuOpt key={o.value} o={o} />
                      ))}
                    </Select.Group>
                  ) : (
                    g.items.map((o) => <MenuOpt key={o.value} o={o} />)
                  )}
                </Fragment>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function MenuOpt({ o }: { o: PickOpt }) {
  return (
    <Select.Item value={o.value} label={o.label} className={cn("pk-o", o.off && "off", o.Icon && "has-i")}>
      {o.Icon && (
        <span className="tile sm">
          <o.Icon className="i" aria-hidden />
        </span>
      )}
      <span className="tx">
        <Select.ItemText className="nmx">{o.label}</Select.ItemText>
        {o.sub && (
          <small>
            {o.off && <WifiOff className="i i-sm" aria-hidden />}
            {o.sub}
          </small>
        )}
      </span>
      <Select.ItemIndicator className="ck">
        <Check className="i i-sm" aria-hidden />
      </Select.ItemIndicator>
    </Select.Item>
  );
}

function SheetPicker({ label, labelledBy, value, options, onChange, placeholder = "Escolha", error, describedBy, Icon, disabled, className, focusKey }: PickerProps) {
  const vid = useId();
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  const selRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        className={cn("pick", error && "is-err", className)}
        aria-haspopup="listbox"
        aria-labelledby={labelledBy ? `${labelledBy} ${vid}` : undefined}
        aria-label={labelledBy ? undefined : `${label}: ${cur?.label ?? placeholder}`}
        aria-describedby={describedBy}
        aria-invalid={error || undefined}
        disabled={disabled}
        data-fk={focusKey}
        onClick={() => setOpen(true)}
      >
        <Face cur={cur} placeholder={placeholder} Icon={Icon} vid={vid} />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={label} initialFocus={cur ? selRef : firstRef}>
        <OptionList
          label={label}
          options={options}
          value={value}
          selRef={selRef}
          firstRef={firstRef}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

function OptionList({
  label,
  options,
  value,
  onPick,
  selRef,
  firstRef,
}: {
  label: string;
  options: PickOpt[];
  value: string | null | undefined;
  onPick: (v: string) => void;
  selRef: RefObject<HTMLButtonElement | null>;
  firstRef: RefObject<HTMLButtonElement | null>;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[next]?.focus();
    e.preventDefault();
  };
  const multi = options.some((o) => o.group) && new Set(options.map((o) => o.group)).size > 1;
  let lastGroup: string | undefined;
  return (
    <div className="opts" role="listbox" aria-label={label} onKeyDown={onKey}>
      {options.map((o, i) => {
        const sel = o.value === value;
        const head = multi && o.group !== lastGroup ? o.group : undefined;
        lastGroup = o.group;
        return (
          <Fragment key={o.value}>
            {head && (
              <p className="opt-g" aria-hidden>
                {head}
              </p>
            )}
            <button
              type="button"
              role="option"
              aria-selected={sel}
              ref={sel ? selRef : i === 0 ? firstRef : undefined}
              className={cn("opt", o.off && "off")}
              onClick={() => onPick(o.value)}
            >
              {o.Icon && (
                <span className="tile sm">
                  <o.Icon className="i" aria-hidden />
                </span>
              )}
              <span className="tx">
                <span className="nmx">{o.label}</span>
                {o.sub && (
                  <small>
                    {o.off && <WifiOff className="i i-sm" aria-hidden />}
                    {o.sub}
                  </small>
                )}
              </span>
              {sel && <Check className="i" aria-hidden />}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Bottom sheet do kit (.sheet) com foco preso, Esc e retorno do foco. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  initialFocus,
  footer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim ed-scrim" />
        <Dialog.Popup className="mk sheet ed-sheet" initialFocus={initialFocus}>
          <span className="sheet-grab" aria-hidden />
          <div className="sh-h">
            <Dialog.Title render={<h3 />}>{title}</Dialog.Title>
            <Dialog.Close className="ibtn" aria-label="Fechar">
              <X className="i" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="sh-b">{children}</div>
          {footer && <div className="sh-f">{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
