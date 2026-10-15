#Requires -RunAsAdministrator
<#
  Instala a central no PC de casa (rode uma vez, como administrador, no PowerShell):
    powershell -ExecutionPolicy Bypass -File ops\instalar.ps1
  O que faz:
    1. Copia a central para C:\Program Files\CasaIntegrador (só administrador escreve) e monta
       o Python e as dependências lá (ops\implantar.ps1). A tarefa SYSTEM roda só dessa cópia.
       Antes, SEM admin: cd frontend; npm ci; npm run build
    2. Pasta de dados em C:\ProgramData\CasaIntegrador (só SYSTEM e Administradores).
    3. Firewall: porta do painel só para a rede local e a tailnet; UDP da Tuya na rede local.
    4. Energia: sem suspensão nem hibernação na tomada.
    5. Tailscale em modo "unattended" (conecta depois do boot, sem login).
    6. Tarefa agendada "Casa Integrador": conta SYSTEM, no boot, reinicia se cair.
  Rodar de novo é seguro (atualiza tudo).
#>
param(
    [int]$Porta = 38471
)
$ErrorActionPreference = 'Stop'
$destino = Join-Path $env:ProgramFiles 'CasaIntegrador'
$dados = Join-Path $env:ProgramData 'CasaIntegrador'
$tarefa = 'Casa Integrador'
$grupo = 'Casa Integrador'

function Passo($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

Passo 'Colmeia (cópia protegida)'
Stop-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue
# Uma central antiga ainda rodando trava os arquivos do Python que vão ser trocados.
Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
& (Join-Path $PSScriptRoot 'implantar.ps1') -Destino $destino

Passo 'Pasta de dados'
New-Item -ItemType Directory -Force $dados | Out-Null
# SIDs fixos (SYSTEM e Administradores): os nomes dos grupos mudam com o idioma do Windows.
icacls $dados /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE) { throw "icacls falhou em $dados" }
Write-Host "  $dados (acesso: SYSTEM e Administradores)"

Passo 'Firewall'
Get-NetFirewallRule -Group $grupo -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$remotos = @('LocalSubnet', '100.64.0.0/10')
New-NetFirewallRule -Group $grupo -DisplayName 'Casa Integrador - painel' -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Porta -RemoteAddress $remotos -Profile Any | Out-Null
New-NetFirewallRule -Group $grupo -DisplayName 'Casa Integrador - anuncios Tuya' -Direction Inbound -Action Allow `
    -Protocol UDP -LocalPort 6666, 6667, 7000 -RemoteAddress LocalSubnet -Profile Any | Out-Null
Write-Host "  TCP ${Porta}: rede local + tailnet. UDP 6666/6667/7000: rede local."
$publicas = Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' -and $_.IPv4Connectivity -ne 'Disconnected' }
foreach ($p in $publicas) {
    Write-Warning "A rede '$($p.InterfaceAlias)' está como Pública. Se for o Wi-Fi/cabo de casa, rode: Set-NetConnectionProfile -InterfaceAlias '$($p.InterfaceAlias)' -NetworkCategory Private"
}

Passo 'Energia'
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
Write-Host '  Suspensão e hibernação desligadas na tomada.'

Passo 'Tailscale'
$ts = Get-Command tailscale -ErrorAction SilentlyContinue
$hosts = @()
if ($ts) {
    tailscale set --unattended=true 2>&1 | Out-Host
    if ($LASTEXITCODE) { Write-Warning 'Não consegui ligar o modo unattended. Rode: tailscale up --unattended=true' }
    try {
        $st = tailscale status --json | ConvertFrom-Json
        $dns = $st.Self.DNSName.TrimEnd('.')
        if ($dns) { $hosts += $dns; $hosts += $dns.Split('.')[0] }
        Write-Host "  Painel pela tailnet: http://$($dns):$Porta"
    } catch { Write-Warning 'Tailscale instalado mas sem status (não logado?).' }
} else {
    Write-Warning 'Tailscale não instalado: o acesso de fora de casa não vai funcionar. https://tailscale.com/download/windows'
}
$hosts += $env:COMPUTERNAME.ToLower()
@(
    "CASA_PORT=$Porta"
    "CASA_HOSTS=$(($hosts | Select-Object -Unique) -join ',')"
) | Set-Content -Encoding utf8 (Join-Path $dados 'casa.env')

Passo 'Tarefa agendada'
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$destino\ops\rodar.ps1`""
$gatilho = New-ScheduledTaskTrigger -AtStartup
$conta = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Stop-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $tarefa -Action $acao -Trigger $gatilho -Principal $conta -Settings $config -Force | Out-Null
# Mata uma central antiga que ainda esteja segurando a porta.
Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-ScheduledTask -TaskName $tarefa

Passo 'Conferindo'
$ok = $false
foreach ($i in 1..30) {
    Start-Sleep -Seconds 1
    try { Invoke-RestMethod "http://127.0.0.1:$Porta/api/health" -TimeoutSec 2 | Out-Null; $ok = $true; break } catch { }
}
if ($ok) {
    Write-Host "  Colmeia no ar: http://localhost:$Porta" -ForegroundColor Green
    Write-Host '  Teste final: reinicie o PC SEM fazer login e abra o painel pelo celular (Tailscale).'
} else {
    Write-Warning "A colmeia não respondeu. Veja $dados\logs\rodar.log e casa.log"
}
