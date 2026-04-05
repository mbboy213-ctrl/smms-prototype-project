# Stop PLC Modbus Simulation
# This script stops the PLC simulator

Write-Host "Stopping PLC Modbus Simulation..." -ForegroundColor Yellow

# Kill any Python processes related to the simulation
$pythonProcesses = Get-Process python -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*plc_simulator.py*"
}

if ($pythonProcesses) {
    foreach ($proc in $pythonProcesses) {
        Write-Host "Stopping PLC Simulator process: $($proc.Id)" -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "PLC Simulator stopped successfully!" -ForegroundColor Green
} else {
    Write-Host "No PLC Simulator processes found running." -ForegroundColor Green
}