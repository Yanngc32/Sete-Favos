// Aparência do card com resposta imediata: a escolha vale na hora (otimista) e vai pra colmeia com um respiro
// (várias trocas seguidas viram um PATCH só). Quando o aparelho volta da central com o mesmo valor, o rascunho sai.
// A troca de tamanho anima: os vizinhos deslizam pro lugar novo (FLIP) e o card muda com um fade curto.
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { normalizePrefs, samePrefs } from "./cardLook";
import type { CardPrefs, Device } from "./types";
import { toast } from "@/components/toast";

const SAVE_DELAY = 350;
const KEEP = 6000;

type Draft = { prefs: CardPrefs | null; timer?: ReturnType<typeof setTimeout>; drop?: ReturnType<typeof setTimeout> };
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function withDraft(device: Device): Device {
  const d = drafts.get(device.id);
  return !d || d.prefs === (device.card ?? null) ? device : { ...device, card: d.prefs };
}

/** Device com o card valendo agora: rascunho local (se ainda não confirmado) ou o que veio da colmeia. */
export function useCardDevice(device: Device): Device {
  useSyncExternalStore(subscribe, () => version);
  return withDraft(device);
}

/** Pra quem calcula a grade (largura dos blocos, linhas do painel): devolve o aparelho com o card valendo agora. */
export function useCardOf(): (device: Device) => Device {
  useSyncExternalStore(subscribe, () => version);
  return withDraft;
}

/** Rascunho confirmado pela colmeia (o aparelho chegou com o mesmo card): solta. */
export function settleCardPrefs(devices: Device[]) {
  let changed = false;
  for (const d of devices) {
    const draft = drafts.get(d.id);
    if (draft && !draft.timer && samePrefs(draft.prefs, d.card)) {
      clearTimeout(draft.drop);
      drafts.delete(d.id);
      changed = true;
    }
  }
  if (changed) emit();
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FLIP_ITEMS = ".ini .devs > .dev, .ep-g > .ep-slot";

/** Mede a grade, aplica a troca e anima do lugar antigo pro novo. */
function withFlip(deviceId: string, apply: () => void, sizeChanged: boolean) {
  if (!sizeChanged || typeof document === "undefined") {
    apply();
    return;
  }
  const before = new Map<Element, DOMRect>();
  for (const el of document.querySelectorAll(FLIP_ITEMS)) before.set(el, el.getBoundingClientRect());
  apply();
  requestAnimationFrame(() => {
    const still = reduced();
    const dur = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-short")) || 220;
    const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim() || "ease-out";
    for (const el of document.querySelectorAll(FLIP_ITEMS)) {
      const mine = el.matches(`[data-dev-id="${CSS.escape(deviceId)}"]`) || el.querySelector(`[data-dev-id="${CSS.escape(deviceId)}"]`);
      if (mine) {
        // O próprio card: fade + leve crescimento (sem esticar o texto).
        el.animate(
          still ? [{ opacity: 0.6 }, { opacity: 1 }] : [{ opacity: 0.55, transform: "scale(.97)" }, { opacity: 1, transform: "none" }],
          { duration: still ? 150 : dur, easing: ease },
        );
        continue;
      }
      if (still) continue;
      const a = before.get(el);
      if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: dur, easing: ease });
    }
  });
}

/** Troca a aparência do card (aparelho ou grupo). `null` = voltar ao padrão. */
export function setCardPrefs(device: Device, next: CardPrefs | null) {
  const prefs = normalizePrefs(next);
  const prev = drafts.get(device.id);
  const current = prev ? prev.prefs : (device.card ?? null);
  if (samePrefs(current, prefs)) return;
  const sizeChanged = (current?.size ?? "m") !== (prefs?.size ?? "m");
  clearTimeout(prev?.timer);
  clearTimeout(prev?.drop);
  const draft: Draft = { prefs };
  withFlip(device.id, () => {
    drafts.set(device.id, draft);
    emit();
  }, sizeChanged);
  draft.timer = setTimeout(() => {
    draft.timer = undefined;
    const body = prefs ? { card: prefs } : { clear_card: true };
    api.devices
      .update(device.id, body)
      .then((saved) => {
        if (drafts.get(device.id) !== draft) return;
        if (samePrefs(saved.card, prefs)) {
          // Espera o aparelho chegar pelo WebSocket com o card novo; se não chegar, solta mesmo assim.
          draft.drop = setTimeout(() => {
            if (drafts.get(device.id) === draft) {
              drafts.delete(device.id);
              emit();
            }
          }, KEEP);
        }
      })
      .catch((err: Error) => {
        if (drafts.get(device.id) !== draft) return;
        withFlip(device.id, () => {
          drafts.delete(device.id);
          emit();
        }, sizeChanged);
        toast({
          id: `card-${device.id}`,
          tone: "error",
          message: `Não consegui salvar o card de ${device.name}${err.message ? `: ${err.message}` : ""}`,
          action: { label: "Tentar de novo", onClick: () => setCardPrefs(device, prefs) },
          duration: 8000,
        });
      });
  }, SAVE_DELAY);
}

/** Anima a troca de tamanho de um card do painel (rascunho do editor, sem colmeia no meio). */
export function flipPanel(deviceId: string, apply: () => void) {
  withFlip(deviceId, apply, true);
}
