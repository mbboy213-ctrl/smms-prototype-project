-- ============================================================
--  PLC Simulation Schema (Multi-Machine)
-- ============================================================

-- 1. System Users
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL          PRIMARY KEY,
    username        VARCHAR(100)    NOT NULL UNIQUE,
    password        VARCHAR(255)    NOT NULL,
    role            VARCHAR(50)     NOT NULL, -- admin, manager, maintenance, operator
    assigned_machine VARCHAR(50),
    created_at      TIMESTAMPTZ     DEFAULT NOW()
);

-- Insert default admin user
INSERT INTO users (username, password, role) 
VALUES ('admin', 'admin123', 'admin')
ON CONFLICT (username) DO NOTHING;

-- 1. Metadata for machines
CREATE TABLE IF NOT EXISTS machines (
    id          SERIAL          PRIMARY KEY,
    name        VARCHAR(50)     NOT NULL UNIQUE,
    type        VARCHAR(50)
);

INSERT INTO machines (id, name, type) VALUES
    (1, 'Broyeur', 'Crusher'),
    (2, 'Atomiseur', 'Atomizer'),
    (3, 'Presse', 'Press'),
    (4, 'Séchoir', 'Dryer'),
    (5, 'Imprimante', 'Printer'),
    (6, 'Fours', 'Kiln'),
    (7, 'Marpak', 'Packaging')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type;

-- 2. Reading logs
CREATE TABLE IF NOT EXISTS plc_readings (
    id              BIGSERIAL       PRIMARY KEY,
    machine_id      INTEGER         REFERENCES machines(id),
    timestamp       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    status_bits     INTEGER         DEFAULT 1, -- 1=Running, 2=Alarm, 4=Fault
    
    -- Sensor Data (Stored as JSONB for flexibility)
    sensor_data     JSONB           NOT NULL DEFAULT '{}'
);

-- Index for efficient time-range and machine-specific queries
CREATE INDEX IF NOT EXISTS idx_plc_readings_timestamp ON plc_readings (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_plc_readings_machine ON plc_readings (machine_id, timestamp DESC);

-- 3. Alert Logs
CREATE TABLE IF NOT EXISTS plc_alerts (
    id              BIGSERIAL       PRIMARY KEY,
    timestamp       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    machine_id      INTEGER         REFERENCES machines(id),
    level           VARCHAR(10)     NOT NULL, -- INFO, WARNING, CRITICAL
    message         TEXT            NOT NULL,
    status_code     INTEGER
);

-- 4. Maintenance Tickets
CREATE TABLE IF NOT EXISTS maintenance_tickets (
    ticket_id       SERIAL          PRIMARY KEY,
    machine_name    VARCHAR(50)     NOT NULL,
    fault_type      VARCHAR(100)    NOT NULL,
    operator_name   VARCHAR(100),
    status          VARCHAR(50)     NOT NULL DEFAULT 'Pending', -- Pending, In Progress, Resolved
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ── Optional views ───────────────────────────────────────────

-- Latest reading per machine
CREATE OR REPLACE VIEW plc_latest AS
    SELECT DISTINCT ON (machine_id) *
    FROM   plc_readings
    ORDER  BY machine_id, timestamp DESC;
