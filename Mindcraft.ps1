# Mindcraft — Windows PowerShell launcher
# Right-click → Run with PowerShell, or run: pwsh -File Mindcraft.ps1

Set-Location $PSScriptRoot

# Check Node is installed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "  ✗ Node.js is not installed." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Download it from https://nodejs.org (choose the LTS version)"
    Write-Host "  Then run this script again."
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

node launcher.mjs @args

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  Mindcraft exited with an error. See above for details." -ForegroundColor Red
    Read-Host "Press Enter to exit"
}
