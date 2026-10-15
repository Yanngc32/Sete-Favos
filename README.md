# Sete Favos

Central de casa inteligente que roda num PC Windows da sua rede e controla os aparelhos **localmente**, sem
depender da nuvem do fabricante no dia a dia. Painel web (PWA) para celular e desktop, app Android com widget,
rotinas e automações.

Aparelhos suportados hoje:

| Marca | O quê | Como fala |
|---|---|---|
| Tuya / Positivo | tomadas, lâmpadas, interruptores | rede local (chaves locais buscadas uma vez na Tuya Cloud) |
| Midea | ar-condicionado | rede local |
| LG webOS | TV (liga por Wake-on-LAN) | rede local |
| Xiaomi | robô aspirador e afins | rede local (miio) |
| Celular Android | bateria e localização | app Android pareado |

## Estrutura

```
backend/    central em Python 3.13 (FastAPI) — adaptadores, motor de rotinas/automações, cofre de segredos
frontend/   painel em React + Vite (PWA), visual "Sete Favos"
android/    app Android (Kotlin) com widget de aparelhos
ops/        scripts para instalar a central como tarefa do Windows — ver ops/README.md
packaging/  build do central.exe (PyInstaller) e instalador (Inno Setup)
```

## Rodar em modo demo (sem aparelhos)

Precisa de [uv](https://docs.astral.sh/uv/) e Node 20+.

```bash
cd frontend && npm ci && npm run build && cd ..
cd backend
uv sync
CASA_SIMULAR=1 CASA_DATA_DIR=.demo uv run casa     # sobe a central simulada
uv run casa-demo                                   # em outro terminal: popula a casa de exemplo
```

Abra `http://localhost:38471`. No PowerShell, defina as variáveis com `$env:CASA_SIMULAR=1; $env:CASA_DATA_DIR=".demo"`.

Para desenvolver o painel com recarga ao vivo: `cd frontend && npm run dev`.

## Instalar de verdade

Siga [ops/README.md](ops/README.md): diagnóstico da rede, instalação como tarefa do Windows, firewall,
acesso remoto pelo Tailscale e pareamento de celulares por QR.

## Testes

```bash
cd backend && uv run pytest
cd frontend && npm test && npm run typecheck
```

## Segurança

- Segredos (chaves Tuya, tokens, senhas de conta) ficam no Gerenciador de Credenciais do Windows, nunca em
  arquivo; a API nunca devolve um segredo.
- Celulares só acessam depois de pareados pelo PC; o acesso pode ser revogado a qualquer momento.
- Achou uma falha? Abra uma issue sem detalhes de exploração e peça um contato privado.

## Licença

[MIT](LICENSE). Componentes de terceiros e suas licenças estão em [licenses/](licenses/).
