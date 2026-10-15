<#
  Rodado pelo instalador (Inno Setup), como administrador. Também na desinstalação (-Remover).
    setup.ps1 -App "C:\Program Files\Central"            instala/atualiza
    setup.ps1 -App "C:\Program Files\Central" -Remover   tira tarefa e firewall (dados ficam)
  O que faz na instalação:
    1. Pasta de dados em %ProgramData%\Central (só SYSTEM e Administradores).
    2. casa.env (porta e nomes aceitos no Host), mantendo a porta escolhida antes.
    3. Firewall: painel só para rede local e tailnet; UDP da Tuya só na rede local.
    4. Energia: sem suspensão nem hibernação na tomada.
    5. Tailscale em modo unattended, se estiver instalado.
    6. Tarefa "Central": conta SYSTEM, no boot, reinicia se cair; e confere /api/health.
#>
param(
    [Parameter(Mandatory)][string]$App,
    [switch]$Remover
)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $App 'central.exe'
$dados = Join-Path $env:ProgramData 'Central'
$tarefa = 'Central'
$grupo = 'Central'
$log = Join-Path $dados 'logs\instalador.log'

New-Item -ItemType Directory -Force (Join-Path $dados 'logs') | Out-Null
Start-Transcript -Path $log -Append | Out-Null
try {
    # Instalação antiga feita pelos scripts de ops\ (tarefa "Casa Integrador"): sai do caminho.
    foreach ($t in @($tarefa, 'Casa Integrador')) {
        if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
            if ($Remover -or $t -ne $tarefa) { Unregister-ScheduledTask -TaskName $t -Confirm:$false }
        }
    }
    Get-NetFirewallRule -Group $grupo, 'Casa Integrador' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

    if ($Remover) {
        Write-Host "Tarefa e firewall removidos. Os dados ficam em $dados."
        return
    }

    # SIDs fixos (SYSTEM e Administradores): os nomes dos grupos mudam com o idioma do Windows.
    icacls $dados /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE) { throw "icacls falhou em $dados" }

    $envFile = Join-Path $dados 'casa.env'
    $porta = 38471
    if (Test-Path $envFile) {
        $linha = Select-String -Path $envFile -Pattern '^\s*CASA_PORT\s*=\s*(\d+)' | Select-Object -First 1
        if ($linha) { $porta = [int]$linha.Matches[0].Groups[1].Value }
    }

    $remotos = @('LocalSubnet', '100.64.0.0/10')
    New-NetFirewallRule -Group $grupo -DisplayName 'Sete Favos - painel' -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $porta -RemoteAddress $remotos -Profile Any | Out-Null
    New-NetFirewallRule -Group $grupo -DisplayName 'Sete Favos - anúncios Tuya' -Direction Inbound -Action Allow `
        -Protocol UDP -LocalPort 6666, 6667, 7000 -RemoteAddress LocalSubnet -Profile Any | Out-Null

    powercfg /change standby-timeout-ac 0
    powercfg /change hibernate-timeout-ac 0

    $hosts = @($env:COMPUTERNAME.ToLower())
    # A CLI do Tailscale nem sempre fica no PATH.
    $ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
    $tsPadrao = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (-not $ts -and (Test-Path $tsPadrao)) { $ts = $tsPadrao }
    if ($ts) {
        & $ts set --unattended=true 2>&1 | Out-Host
        try {
            $dns = (& $ts status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
            if ($dns) { $hosts += $dns; $hosts += $dns.Split('.')[0] }
        } catch { Write-Warning 'Tailscale sem status (não logado?).' }
    }
    @(
        "CASA_PORT=$porta"
        "CASA_HOSTS=$(($hosts | Select-Object -Unique) -join ',')"
    ) | Set-Content -Encoding utf8 $envFile

    $acao = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $App
    $gatilho = New-ScheduledTaskTrigger -AtStartup
    $conta = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $tarefa -Action $acao -Trigger $gatilho -Principal $conta -Settings $config -Force | Out-Null
    Start-ScheduledTask -TaskName $tarefa

    foreach ($i in 1..30) {
        Start-Sleep -Seconds 1
        try { Invoke-RestMethod "http://127.0.0.1:$porta/api/health" -TimeoutSec 2 | Out-Null; Write-Host "Colmeia no ar na porta $porta."; return } catch { }
    }
    throw "A colmeia não respondeu em 30 s. Veja $dados\logs\casa.log"
} finally {
    Stop-Transcript | Out-Null
}
