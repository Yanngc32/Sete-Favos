<#
  Copia a central para uma pasta que só administradores escrevem e monta o Python lá.
  Motivo: a tarefa roda como SYSTEM. Se ela executasse código de uma pasta que o seu usuário comum
  escreve (a pasta do projeto, o Python do uv no seu perfil), qualquer programa seu viraria SYSTEM
  no próximo boot.
  Chamado por instalar.ps1; também pode rodar sozinho para atualizar o código:
    powershell -ExecutionPolicy Bypass -File ops\implantar.ps1
  Antes, SEM admin: cd frontend; npm ci; npm run build   (gera frontend\dist)
  -SemAcl existe só para testar a montagem num destino temporário.
#>
param(
    [string]$Destino = (Join-Path $env:ProgramFiles 'CasaIntegrador'),
    [switch]$SemAcl
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $raiz 'frontend\dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) {
    throw "Não achei $dist. Rode antes, SEM administrador: cd frontend; npm ci; npm run build"
}

function Copiar($de, $para) {
    robocopy $de $para /MIR /XD __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy falhou ($de)" }
    $global:LASTEXITCODE = 0
}

Write-Host "Copiando a colmeia para $Destino"
New-Item -ItemType Directory -Force (Join-Path $Destino 'backend'), (Join-Path $Destino 'ops') | Out-Null
Copiar (Join-Path $raiz 'backend\src') (Join-Path $Destino 'backend\src')
Copy-Item -Force (Join-Path $raiz 'backend\pyproject.toml'), (Join-Path $raiz 'backend\uv.lock') (Join-Path $Destino 'backend')
Copiar $dist (Join-Path $Destino 'frontend\dist')
Copy-Item -Force (Join-Path $PSScriptRoot 'rodar.ps1') (Join-Path $Destino 'ops\rodar.ps1')

Write-Host 'Montando o Python e as dependências (uv sync)'
# Python gerenciado e venv ficam dentro do destino, nunca no perfil do usuário.
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Destino 'python'
$env:UV_PROJECT_ENVIRONMENT = Join-Path $Destino 'venv'
Push-Location (Join-Path $Destino 'backend')
try {
    uv sync --frozen --no-dev --no-editable --python 3.13
    if ($LASTEXITCODE) { throw 'uv sync falhou' }
} finally { Pop-Location }
$python = Join-Path $Destino 'venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "Não achei $python" }

if (-not $SemAcl) {
    Write-Host 'Travando permissões (SYSTEM e Administradores escrevem; Usuários só leem)'
    # SIDs fixos (SYSTEM, Administradores, Usuários): os nomes mudam com o idioma do Windows.
    icacls $Destino /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' /T /C /Q | Out-Null
    if ($LASTEXITCODE) { throw 'icacls falhou' }
}
Write-Host "  Pronto: $Destino" -ForegroundColor Green
