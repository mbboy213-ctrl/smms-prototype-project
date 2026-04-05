# Start PLC Modbus Simulation
# This script starts the PLC simulator

Write-Host "Starting PLC Modbus Simulation..." -ForegroundColor Green

# Activate virtual environment
& ".\.venv\Scripts\Activate.ps1"

# Start PLC Simulator
Write-Host "Starting PLC Simulator..." -ForegroundColor Yellow
& ".\.venv\Scripts\python.exe" ".\plc-simulator\plc_simulator.py"