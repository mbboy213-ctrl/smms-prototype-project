-- Initialize database for Smart Monitoring Maintenance System

-- Create machines table
CREATE TABLE IF NOT EXISTS machines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    type VARCHAR(255)
);

-- Add unique constraint if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'machines_name_unique') THEN
        ALTER TABLE machines ADD CONSTRAINT machines_name_unique UNIQUE (name);
    END IF;
END $$;

-- Create maintenance_tickets table
CREATE TABLE IF NOT EXISTS maintenance_tickets (
    ticket_id SERIAL PRIMARY KEY,
    machine_name VARCHAR(255) NOT NULL,
    fault_type VARCHAR(255) NOT NULL,
    operator_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create plc_data table
CREATE TABLE IF NOT EXISTS plc_data (
    id SERIAL PRIMARY KEY,
    machine_name VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status_bits INTEGER,
    sensor_data JSONB
);

-- Create plc_readings table for logs
CREATE TABLE IF NOT EXISTS plc_readings (
    id BIGSERIAL PRIMARY KEY,
    machine_id INTEGER REFERENCES machines(id),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status_bits INTEGER DEFAULT 1,
    sensor_data JSONB NOT NULL DEFAULT '{}'
);

-- Create plc_alerts table for alerts
CREATE TABLE IF NOT EXISTS plc_alerts (
    id BIGSERIAL PRIMARY KEY,
    machine_id INTEGER REFERENCES machines(id),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level VARCHAR(20),
    message TEXT,
    status_code INTEGER
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_plc_readings_timestamp ON plc_readings (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_plc_readings_machine ON plc_readings (machine_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_plc_alerts_timestamp ON plc_alerts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_plc_alerts_machine ON plc_alerts (machine_id, timestamp DESC);

-- Create view for latest PLC readings
CREATE OR REPLACE VIEW plc_latest AS
SELECT DISTINCT ON (machine_id) 
    machine_id,
    timestamp,
    status_bits,
    sensor_data
FROM plc_readings 
ORDER BY machine_id, timestamp DESC;

-- Create users table if not exists (for login)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    assigned_machine VARCHAR(255)
);

-- Insert sample machines
INSERT INTO machines (name, type) VALUES
('Broyeur', 'Crusher'),
('Atomiseur', 'Sprayer'),
('Presse', 'Press'),
('Séchoir', 'Dryer'),
('Imprimante', 'Printer'),
('Four', 'Oven'),
('Marpack', 'Packer')
ON CONFLICT (name) DO NOTHING;

-- Insert sample PLC data
INSERT INTO plc_data (machine_name, status_bits, sensor_data) VALUES
('Broyeur', 1, '{"temperature": 42, "speed": 1500, "status": "ON", "pressure": 2.1, "alert_count": 0}'),
('Atomiseur', 1, '{"temperature": 38, "speed": 1200, "status": "ON", "pressure": 1.8, "alert_count": 0}'),
('Presse', 1, '{"temperature": 45, "speed": 1800, "status": "ON", "pressure": 2.5, "alert_count": 0}'),
('Séchoir', 1, '{"temperature": 65, "speed": 800, "status": "ON", "pressure": 1.2, "alert_count": 0}'),
('Imprimante', 1, '{"temperature": 35, "speed": 2000, "status": "ON", "pressure": 1.5, "alert_count": 0}'),
('Four', 1, '{"temperature": 180, "speed": 600, "status": "ON", "pressure": 0.8, "alert_count": 0}'),
('Marpack', 1, '{"temperature": 28, "speed": 900, "status": "ON", "pressure": 1.0, "alert_count": 0}');

-- Insert sample users
INSERT INTO users (username, password, role, assigned_machine) VALUES
('manager', 'manager123', 'manager', NULL),
('operator1', 'op123', 'operator', 'Broyeur'),
('operator2', 'op123', 'operator', 'Atomiseur')
ON CONFLICT (username) DO NOTHING;