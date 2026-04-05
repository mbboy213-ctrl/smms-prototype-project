#!/usr/bin/env python3
"""
Simple Modbus Data Collector
Collects data from PLC simulator and displays it
"""

import json
import logging
import os
import time
from pathlib import Path

import psycopg2
from psycopg2.extras import Json
from pymodbus.client import ModbusTcpClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [COLLECTOR] %(levelname)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parents[1]


def _load_dotenv(path: Path):
    if not path.exists():
        return

    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv(ROOT_DIR / ".env")

MODBUS_HOST = os.getenv("MODBUS_HOST", os.getenv("DB_HOST", "localhost"))
MODBUS_PORT = int(os.getenv("MODBUS_PORT", 5020))
POLL_INTERVAL = 5.0

DB_HOST = os.getenv("POSTGRES_HOST", os.getenv("DB_HOST", "localhost"))
DB_PORT = int(os.getenv("POSTGRES_PORT", os.getenv("DB_PORT", 5432)))
DB_NAME = os.getenv("POSTGRES_DB", os.getenv("DB_NAME", "smart_factory_db"))
DB_USER = os.getenv("POSTGRES_USER", os.getenv("DB_USER", "postgres"))
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", os.getenv("DB_PASSWORD", ""))

ALERT_CODE_MAP = {
    1: {"level": "WARNING", "message": "overspeed from motor 02"},
    2: {"level": "WARNING", "message": "over temperature on motor 02"},
    3: {"level": "WARNING", "message": "vibration spike on motor 02"},
    4: {"level": "WARNING", "message": "low pressure in pump 03"},
    5: {"level": "CRITICAL", "message": "power supply fluctuation detected"},
}

MACHINE_NAMES = [
    "",
    "Broyeur",
    "Atomiseur",
    "Presse",
    "Séchoir",
    "Imprimante",
    "Fours",
    "Marpak",
]


def _connect_db():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )


def _insert_alerts(cursor, machine_id, alerts):
    insert_sql = (
        "INSERT INTO plc_alerts (machine_id, level, message, status_code) "
        "VALUES (%s, %s, %s, %s)"
    )
    for alert in alerts:
        cursor.execute(
            insert_sql,
            (machine_id, alert["level"], alert["message"], alert["code"]),
        )


def _insert_reading(cursor, machine_id, status_bits, sensor_data):
    insert_sql = (
        "INSERT INTO plc_readings (machine_id, status_bits, sensor_data) "
        "VALUES (%s, %s, %s)"
    )
    cursor.execute(insert_sql, (machine_id, status_bits, Json(sensor_data)))


def collect_data(db_conn):
    """Collect data from all PLC slaves and persist alerts to PostgreSQL."""
    client = ModbusTcpClient(MODBUS_HOST, port=MODBUS_PORT)

    if not client.connect():
        log.error("Failed to connect to PLC simulator")
        return

    try:
        with db_conn.cursor() as cursor:
            for slave_id in range(1, 8):
                # Read holding registers (function code 3)
                response = client.read_holding_registers(0x00, 10, slave=slave_id)

                if response.isError():
                    log.warning(f"Error reading from slave {slave_id}: {response}")
                    continue

                registers = response.registers
                temp = registers[0]
                pressure = registers[1]
                speed = registers[2]
                status = registers[3]
                alert_count = registers[4]
                alert_codes = registers[5:5 + min(alert_count, 4)]

                machine_name = MACHINE_NAMES[slave_id] if slave_id < len(MACHINE_NAMES) else f"Machine {slave_id}"

                log.info(
                    f"{machine_name} (ID:{slave_id}): Temp={temp}°C, Pressure={pressure}bar, Speed={speed}RPM, Status={'ON' if status else 'OFF'}"
                )

                alerts = [
                    {
                        "code": code,
                        "level": ALERT_CODE_MAP[code]["level"] if code in ALERT_CODE_MAP else "UNKNOWN",
                        "message": ALERT_CODE_MAP[code]["message"] if code in ALERT_CODE_MAP else f"UNKNOWN_ALERT_{code}",
                    }
                    for code in alert_codes
                    if code
                ]

                status_bits = 0
                if status == 1:
                    status_bits |= 1
                if alerts:
                    status_bits |= 2

                sensor_data = {
                    "temperature": temp,
                    "pressure": pressure,
                    "speed": speed,
                    "status": "ON" if status == 1 else "OFF",
                    "alert_count": len(alerts),
                    "alert_codes": [alert["code"] for alert in alerts],
                }

                _insert_reading(cursor, slave_id, status_bits, sensor_data)

                if alerts:
                    log.warning(
                        f"{machine_name} (ID:{slave_id}) Alerts={len(alerts)}: {', '.join(a['level'] for a in alerts)}"
                    )
                    _insert_alerts(cursor, slave_id, alerts)

            db_conn.commit()

    except Exception as e:
        log.error(f"Error collecting data: {e}")
        db_conn.rollback()
    finally:
        client.close()


def main():
    log.info("Starting Modbus Data Collector...")
    log.info(f"Connecting to PLC simulator at {MODBUS_HOST}:{MODBUS_PORT}")
    log.info(f"Connecting to PostgreSQL at {DB_HOST}:{DB_PORT}/{DB_NAME}")

    try:
        db_conn = _connect_db()
    except Exception as e:
        log.error(f"Failed to connect to PostgreSQL: {e}")
        return

    try:
        while True:
            collect_data(db_conn)
            time.sleep(POLL_INTERVAL)
    finally:
        db_conn.close()

if __name__ == "__main__":
    main()
