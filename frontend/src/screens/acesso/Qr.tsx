import { useMemo } from "react";
import { encode } from "uqr";

/** QR em SVG: escuro (--color-qr-ink) sobre claro (--color-qr-paper) nos dois temas. */
export function Qr({ value, label, className = "qr" }: { value: string; label?: string; className?: string }) {
  const { d, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 0 });
    let path = "";
    qr.data.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (!row[x]) {
          x++;
          continue;
        }
        const start = x;
        while (x < row.length && row[x]) x++;
        path += `M${start} ${y + 0.5}h${x - start}`;
      }
    });
    return { d: path, size: qr.size };
  }, [value]);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${size} ${size}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={d} />
    </svg>
  );
}
