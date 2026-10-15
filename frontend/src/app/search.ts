// Busca rápida (Ctrl+K): o botão do menu lateral e o atalho só pedem pra abrir;
// quem desenha a paleta é o componente da busca (montado na casca).
type Listener = (open: boolean) => void;
const listeners = new Set<Listener>();

export function openSearch() {
  listeners.forEach((l) => l(true));
}

export function onSearchRequest(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
