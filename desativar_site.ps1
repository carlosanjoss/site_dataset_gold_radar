$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$tunnelPidPath = Join-Path $PSScriptRoot "logs\cloudflare.pid"
$tunnelUrlPath = Join-Path $PSScriptRoot "logs\cloudflare.url"
$appPidPath = Join-Path $PSScriptRoot "logs\app.pid"
$stoppedTunnel = $false

if (Test-Path -LiteralPath $tunnelPidPath) {
    $tunnelPid = [int](Get-Content -LiteralPath $tunnelPidPath -ErrorAction SilentlyContinue)
    $tunnelProcess = Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue
    if ($tunnelProcess -and $tunnelProcess.ProcessName -eq "cloudflared") {
        Stop-Process -Id $tunnelPid
        $stoppedTunnel = $true
    }
    Remove-Item -LiteralPath $tunnelPidPath -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $tunnelUrlPath -Force -ErrorAction SilentlyContinue

$productionListener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($productionListener) {
    Stop-Process -Id $productionListener.OwningProcess -Force -ErrorAction Stop
    Write-Host "Servidor de producao encerrado (porta 3001)."
}
Remove-Item -LiteralPath $appPidPath -Force -ErrorAction SilentlyContinue

if ($stoppedTunnel) {
    Write-Host "Acesso publico pelo Cloudflare desativado."
} else {
    Write-Host "Nenhum tunel Cloudflare deste projeto estava ativo."
}

Write-Host "A execucao local na porta 3000 nao foi alterada."
