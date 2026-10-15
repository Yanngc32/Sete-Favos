#Requires -RunAsAdministrator
# Remove a tarefa agendada, as regras do Firewall e a cópia do código (Program Files). Os dados (C:\ProgramData\CasaIntegrador)
# e os segredos no cofre da conta SYSTEM só saem com -ApagarDados.
param([switch]$ApagarDados)
$ErrorActionPreference = 'Continue'
$tarefa = 'Casa Integrador'
Stop-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $tarefa -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -Group 'Casa Integrador' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match '-m casa' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
if ($ApagarDados) {
    Remove-Item -Recurse -Force (Join-Path $env:ProgramData 'CasaIntegrador') -ErrorAction SilentlyContinue
    Write-Warning 'Os segredos ficam no cofre da conta SYSTEM até serem sobrescritos; remova pelo painel antes de desinstalar se quiser apagá-los.'
}
Remove-Item -Recurse -Force (Join-Path $env:ProgramFiles 'CasaIntegrador') -ErrorAction SilentlyContinue
Write-Host 'Colmeia removida.'
