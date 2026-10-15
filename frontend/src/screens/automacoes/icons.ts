// Ícone de rotina/objeto virtual pelo nome (o modelo não guarda ícone). Sem cor: só o desenho diz o que é.
import {
  Bed,
  BriefcaseBusiness,
  CirclePlay,
  Clapperboard,
  Coffee,
  DoorOpen,
  House,
  Moon,
  Sunrise,
  ToggleRight,
  TreePalm,
  Users,
  type LucideIcon,
} from "lucide-react";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ROUTINE: [RegExp, LucideIcon][] = [
  [/sair|saida|fora/, DoorOpen],
  [/dormir|noite|deitar/, Moon],
  [/cinema|filme|tv/, Clapperboard],
  [/acordar|manha|bom dia/, Sunrise],
  [/cafe/, Coffee],
  [/chegar|cheguei|casa/, House],
  [/trabalh/, BriefcaseBusiness],
];

const VIRTUAL: [RegExp, LucideIcon][] = [
  [/visita/, Users],
  [/dorm/, Bed],
  [/feria|viage/, TreePalm],
  [/fora|ausente/, DoorOpen],
];

function match(name: string, table: [RegExp, LucideIcon][], fallback: LucideIcon) {
  const n = norm(name);
  return table.find(([re]) => re.test(n))?.[1] ?? fallback;
}

export const routineIcon = (name: string) => match(name, ROUTINE, CirclePlay);
export const virtualIcon = (name: string) => match(name, VIRTUAL, ToggleRight);
