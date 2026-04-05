# PLC Modbus Data Simulation Service

This project simulates an industrial PLC that exposes sensor data via the Modbus TCP protocol and logs that data into a local PostgreSQL database for historical analysis.

## Features
- **PLC Simulator**: Generates realistic, drifting sensor data (Temperature, Pressure, Flow Rate, Motor RPM, Voltage).
- **Data Collector**: Bridges Modbus data to PostgreSQL.
*   **Local Run**: Run natively on Windows via PowerShell scripts.

## Prerequisites
1.  **Python 3.11+**: Installed via uv
2.  **PostgreSQL 18+**: Local PostgreSQL service running on port 4297
*   **Database Credentials**: Configured in `.env` file with your local database settings.

## Setup & Running

### 1. Install Dependencies
Dependencies are already installed via uv in the virtual environment.

### 2. Configuration
The `.env` file is configured with your local PostgreSQL credentials:
- `POSTGRES_USER`: postgres
- `POSTGRES_PASSWORD`: Mokrim244
- `POSTGRES_DB`: smart_factory_db
- `POSTGRES_HOST`: localhost
- `POSTGRES_PORT`: 4297

### 3. Run the Simulation
To start both the PLC simulator and the data collector:
```powershell
.\run_local.ps1
```

### 4. Stop the Simulation
To stop all simulation services:
```powershell
.\stop_local.ps1
```

## Database Schema
The data is stored in the `plc_readings` table. You can check the latest reading using the `plc_latest` view:
```powershell
$env:PGPASSWORD = "your_password"; & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U your_user -h localhost -d plc_data -c "SELECT * FROM plc_latest;"
```
