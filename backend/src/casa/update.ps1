<#
  Rodado pela tarefa "Central Atualizador" (SYSTEM), criada pela própria central (casa/updater.py).
  Fica fora do processo da central: o instalador para a central para trocar os arquivos.
  1. Instala a versão nova em modo silencioso.
  2. Espera /api/health responder (até 2 min).
  3. Se não responder e houver o instalador da versão anterior (assinatura já conferida), reinstala ele.
#>
param(
    [Parameter(Mandatory)][string]$Novo,
    [string]$Anterior = '',
    [int]$Porta = 38471
)
$ErrorActionPreference = 'Continue'
$logs = Join-Path $env:ProgramData 'Central\logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs 'atualizacao.log'
function Log($t) { "$(Get-Date -Format s) $t" | Add-Content -Encoding utf8 $log }

function Instalar($instalador) {
    $nome = [IO.Path]::GetFileNameWithoutExtension($instalador)
    $p = Start-Process -FilePath $instalador -Wait -PassThru -ArgumentList @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$(Join-Path $logs "$nome.log")`""
    )
    Log "$nome terminou com código $($p.ExitCode)"
    return $p.ExitCode -eq 0
}

function NoAr() {
    foreach ($i in 1..60) {
        Start-Sleep -Seconds 2
        try { Invoke-RestMethod "http://127.0.0.1:$Porta/api/health" -TimeoutSec 2 | Out-Null; return $true } catch { }
    }
    return $false
}

Log "atualizando com $Novo"
if ((Instalar $Novo) -and (NoAr)) {
    Log 'atualização concluída'
    exit 0
}
Log 'a versão nova não subiu'
if ($Anterior -and (Test-Path $Anterior)) {
    Log "voltando para $Anterior"
    if ((Instalar $Anterior) -and (NoAr)) { Log 'versão anterior restaurada'; exit 2 }
    Log 'a versão anterior também não subiu'
}
exit 1
