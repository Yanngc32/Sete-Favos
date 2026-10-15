# Central da casa: instalar e operar no PC de casa

Tudo roda no PC Windows que fica ligado, na mesma rede dos aparelhos. Precisa de: `uv`, Node 20+ e Tailscale.

## 1. Diagnóstico (antes de instalar)
No PC de casa, na pasta `backend`:

```powershell
uv sync
uv run casa-diag                         # ouve a rede: Tuya/Positivo, Midea, LG, Xiaomi
uv run casa-diag --xiaomi-conta voce@exemplo.com   # + testa o H50 Pro (pede a senha na hora, não salva)
```

- Só escuta e faz leituras; não manda comando para nenhum aparelho.
- Gera `diagnostico.json` (sem segredos).
- **H50 Pro:** se o teste disser `"controle_local": true`, o robô fala pela rede local. Se der erro no `miot`,
  ele não tem controle local e a gente decide o próximo passo antes de seguir com a tela do robô.
- Nada apareceu? Confira se a rede do Windows está como **Privada** e se o PC está no mesmo roteador.

## 2. Instalar (uma vez, PowerShell como administrador)

Antes, **sem administrador**, gere o painel (o instalador não roda `npm` elevado):

```powershell
cd frontend; npm ci; npm run build; cd ..
```

Depois, como administrador:

```powershell
powershell -ExecutionPolicy Bypass -File ops\instalar.ps1
```

Faz: copia a central e monta o Python em `C:\Program Files\CasaIntegrador` (só administrador escreve; a tarefa
roda como SYSTEM e só executa código dessa cópia), pasta de dados em `C:\ProgramData\CasaIntegrador`, regras do
Firewall (painel só para rede local e tailnet; UDP 6666/6667/7000 da Tuya só na rede local), sem
suspensão/hibernação, Tailscale em modo unattended e a tarefa agendada **Casa Integrador** (conta SYSTEM, no boot,
reinicia se cair).

Rodar de novo é seguro e é como se atualiza o código (rode `npm run build` antes se mexeu no painel). Para
remover: `ops\desinstalar.ps1` (dados ficam; `-ApagarDados` apaga).

**Não rode proxy TCP local para a porta do painel** (`netsh interface portproxy`, `ssh -L/-R`,
`tailscale serve --tcp`): um pedido que chega por ele sai do próprio PC e a central o trata como o PC. Para
abrir de fora, use só o Tailscale direto, como já está.

## 3. Teste de aceite
1. Reinicie o PC e **não faça login**.
2. No celular, com Tailscale ligado e no 4G: abra `http://<nome-do-pc>:38471`. Deve aparecer "Este aparelho
   ainda não tem acesso".
3. Faça login no PC, abra `http://localhost:38471` → Ajustes → Acesso → **Parear novo aparelho**; leia o QR.
4. No celular deve abrir a Início. Revogue no PC: o próximo comando do celular é recusado na hora.

## Onde ficam as coisas
| O quê | Onde |
|---|---|
| Código e Python da central (somente leitura para o usuário comum) | `C:\Program Files\CasaIntegrador` |
| Banco (aparelhos, rotinas, automações, acessos com hash) | `C:\ProgramData\CasaIntegrador\casa.db` |
| Logs | `C:\ProgramData\CasaIntegrador\logs\` (`casa.log`, `rodar.log`) |
| Segredos (chaves Tuya, tokens, client_key da TV) | Gerenciador de Credenciais da conta SYSTEM (`casa-integrador`) |
| Configuração da tarefa | `C:\ProgramData\CasaIntegrador\casa.env` (porta e nomes aceitos) |

Os segredos são gravados pela própria central (tela Adicionar aparelho). A API nunca devolve um segredo; as
senhas das contas Midea e Xiaomi são usadas uma vez e descartadas.

## Problemas comuns
- **Painel não abre pelo celular:** Tailscale ligado nos dois? `tailscale status` no PC. O nome do PC está em
  `CASA_HOSTS` no `casa.env`? (rode o instalador de novo depois de logar no Tailscale).
- **Aparelho Tuya "Sem resposta":** o app oficial pode estar conectado ao mesmo tempo (muitos aceitam 1 conexão
  local). Se o aparelho foi resetado, a `local_key` mudou: remova e adicione de novo.
- **Plano de teste da Tuya expirou:** renove em iot.tuya.com; só é preciso para adicionar aparelhos novos.
