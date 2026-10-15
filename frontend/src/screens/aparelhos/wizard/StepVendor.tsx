import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check } from "lucide-react";
import type { Vendor } from "@/lib/types";
import { vendorLine, wordmark } from "./model";

/** Passo 1: fabricante só com o nome em tipografia + a linha do que ele cobre. */
export function StepVendor({
  vendors,
  value,
  onChange,
  errorId,
}: {
  vendors: Vendor[] | null;
  value: string | null;
  onChange: (vendor: string) => void;
  errorId?: string;
}) {
  if (!vendors) {
    return (
      <div className="mfs" aria-busy="true" aria-label="Carregando fabricantes">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="sk mf-sk" />
        ))}
      </div>
    );
  }
  return (
    <RadioGroup
      className="mfs"
      aria-label="Fabricante"
      aria-describedby={errorId}
      value={value ?? ""}
      onValueChange={(v) => onChange(String(v))}
    >
      {vendors.map((v) => {
        const wm = wordmark(v.label);
        return (
          <Radio.Root key={v.vendor} value={v.vendor} nativeButton render={<button type="button" className="mf" />}>
            <span className="tx">
              <span className="wm">
                {wm.name}
                {wm.small && <small> {wm.small}</small>}
              </span>
              <span className="ln">{vendorLine(v)}</span>
            </span>
            <span className="rd" aria-hidden>
              <Check className="i" />
            </span>
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}
