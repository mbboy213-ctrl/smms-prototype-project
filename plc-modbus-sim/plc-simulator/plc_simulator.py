#!/usr/bin/env python3
"""
Simple PLC Modbus Simulator
Simulates basic Modbus registers for testing purposes
"""

import asyncio
import logging
import math
import os
import random
import time
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusSlaveContext,
    ModbusServerContext,
)
from pymodbus.server import StartAsyncTcpServer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [PLC-SIM] %(levelname)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

MODBUS_PORT = int(os.getenv("MODBUS_PORT", 5020))
UPDATE_INTERVAL = 1.0

ALERT_TYPES = [
    {"code": 1, "level": "WARNING", "message": "overspeed from motor 02"},
    {"code": 2, "level": "WARNING", "message": "over temperature on motor 02"},
    {"code": 3, "level": "WARNING", "message": "vibration spike on motor 02"},
    {"code": 4, "level": "WARNING", "message": "low pressure in pump 03"},
    {"code": 5, "level": "CRITICAL", "message": "power supply fluctuation detected"},
]

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


def _drift(t, base, amp, period, noise):
    return base + amp * math.sin(2 * math.pi * t / period) + random.gauss(0, noise)

def _generate_alerts(t, slave_id):
    window = int(t // 30)
    rand = random.Random(slave_id * 1000 + window)
    count = rand.randint(3, 4)
    alerts = rand.sample(ALERT_TYPES, k=count)
    return alerts, window


async def update_registers(context):
    """Update holding registers with simulated data"""
    start_time = time.time()
    last_alert_window = {}

    while True:
        t = time.time() - start_time

        # Simulate 7 machines with basic sensor data
        for slave_id in range(1, 8):
            # Temperature (0-100°C)
            temp = int(_drift(t + slave_id * 10, 25, 15, 60, 2))
            temp = max(0, min(100, temp))

            # Pressure (43-48 bar)
            pressure = int(_drift(t + slave_id * 45, 45, 46, 45, 45))
            pressure = max(43, min(48, pressure))

            # Speed (0-3000 RPM)
            speed = int(_drift(t + slave_id * 20, 1500, 500, 30, 50))
            speed = max(0, min(3000, speed))

            # Status (0=off, 1=on)
            status = 1 if random.random() > 0.05 else 0  # 95% uptime

            # Simulate alerts in 30-second windows
            alerts, alert_window = _generate_alerts(t, slave_id)
            if last_alert_window.get(slave_id) != alert_window:
                last_alert_window[slave_id] = alert_window
                machine_name = MACHINE_NAMES[slave_id] if slave_id < len(MACHINE_NAMES) else f"Machine {slave_id}"
                for alert in alerts:
                    log.warning(f"{machine_name} (ID:{slave_id}) {alert['level']}: {alert['message']}")

            alert_count = len(alerts)
            alert_codes = [0, 0, 0, 0]
            for idx, alert in enumerate(alerts[:4]):
                alert_codes[idx] = alert["code"]

            values = [temp, pressure, speed, status, alert_count, *alert_codes]
            values += [0] * (10 - len(values))

            context[slave_id].setValues(3, 0x00, values)

        log.info("Updated registers for 7 machines")
        await asyncio.sleep(UPDATE_INTERVAL)

async def run_server():
    log.info(f"Starting PLC Modbus Simulator on port {MODBUS_PORT}...")

    slaves = {}
    for i in range(1, 8):
        slaves[i] = ModbusSlaveContext(hr=ModbusSequentialDataBlock(0x00, [0]*10))

    context = ModbusServerContext(slaves=slaves, single=False)
    asyncio.create_task(update_registers(context))

    await StartAsyncTcpServer(context=context, address=("0.0.0.0", MODBUS_PORT))

if __name__ == "__main__":
    asyncio.run(run_server())
