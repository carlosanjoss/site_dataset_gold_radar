$ErrorActionPreference = "Stop"
$taskName = "RadarOdioNgrok"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

$ngrokProcesses = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq "ngrok.exe" -and
        $_.CommandLine -match "http://127\.0\.0\.1:3000"
    }

foreach ($process in $ngrokProcesses) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "Tunel ngrok do Radar Odio encerrado." -ForegroundColor Green
