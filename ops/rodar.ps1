# Roda a central e reinicia se ela cair. Chamado pela tarefa agendada "Casa Integrador"
# (conta SYSTEM, no boot, sem precisar de login). Não rode à mão como outro usuário:
# o cofre (Gerenciador de Credenciais) é por conta.
$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
$dados = Join-Path $env:ProgramData 'CasaIntegrador'
# Instalado (ops\implantar.ps1): <destino>\venv. Fora disso (desenvolvimento): backend\.venv.
$python = Join-Path $raiz 'venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = Join-Path $raiz 'backend\.venv\Scripts\python.exe' }
$envFile = Join-Path $dados 'casa.env'

New-Item -ItemType Directory -Force (Join-Path $dados 'logs') | Out-Null
$log = Join-Path $dados 'logs\rodar.log'

while ($true) {
    $env:CASA_DATA_DIR = $dados
    $env:CASA_FRONTEND_DIR = Join-Path $raiz 'frontend\dist'
    $env:PYTHONUTF8 = '1'
    if (Test-Path $envFile) {
        foreach ($linha in Get-Content $envFile) {
            if ($linha -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
                Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim()
            }
        }
    }
    "$(Get-Date -Format s) iniciando central" | Add-Content $log
    & $python -m casa *>> $log
    "$(Get-Date -Format s) central saiu (código $LASTEXITCODE); reinicia em 5 s" | Add-Content $log
    Start-Sleep -Seconds 5
}
