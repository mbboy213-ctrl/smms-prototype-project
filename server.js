require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Serve static files from current directory
app.use(express.static('.'));

// Database Connection
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const ALLOWED_ROLES = new Set(['manager', 'maintenance', 'operator']);

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

// --- 1. UNIFIED LOGIN ROUTE ---
// Handles both Manager and Operator logins
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`Log: Login attempt for: ${username}`);

    try {
        const result = await pool.query(
            'SELECT username, assigned_machine, role FROM users WHERE username = $1 AND password = $2',
            [username, password]
        );

        if (result.rows.length > 0) {
            console.log(`Log: Login Successful: ${username} (${result.rows[0].role})`);
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "Invalid credentials" });
        }
    } catch (err) {
        console.error("Database Error:", err.message);
        res.status(500).json({ error: 'Database Error' });
    }
});

// --- 2. USER MANAGEMENT (For Manager Dashboard) ---

// Fetch all users to show in the table
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT username, role, assigned_machine FROM users ORDER BY role DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new user account
app.post('/api/register', async (req, res) => {
    const username = normalizeText(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = normalizeText(req.body.role).toLowerCase();
    const machine = normalizeText(req.body.machine);

    try {
        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        if (username.length < 3 || username.length > 50) {
            return res.status(400).json({ error: 'Username must be between 3 and 50 characters' });
        }

        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        if (!ALLOWED_ROLES.has(role)) {
            return res.status(400).json({ error: 'Role must be manager, maintenance, or operator' });
        }

        let assignedMachine = null;
        if (role === 'operator') {
            if (!machine || machine === 'None') {
                return res.status(400).json({ error: 'Operator must be assigned to a machine' });
            }

            const machineCheck = await pool.query('SELECT name FROM machines WHERE name = $1', [machine]);
            if (machineCheck.rows.length === 0) {
                return res.status(400).json({ error: 'Assigned machine does not exist' });
            }
            assignedMachine = machine;
        }

        await pool.query(
            'INSERT INTO users (username, password, role, assigned_machine) VALUES ($1, $2, $3, $4)',
            [username, password, role, assignedMachine]
        );
        res.status(200).json({ message: "User created" });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

// --- 3. MAINTENANCE TICKETS ---

app.post('/send_fault', async (req, res) => {
    const { machineName, faultType, operator, status } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO maintenance_tickets (machine_name, fault_type, operator_name, status, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING *',
            [machineName, faultType, operator, status]
        );
        const ticket = result.rows[0];
        io.emit('notify_maintenance', ticket); 
        res.status(200).json({ message: 'Success', ticket });
    } catch (err) {
        res.status(500).json({ error: 'Database Error' });
    }
});

app.get('/tickets', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM maintenance_tickets ORDER BY updated_at DESC, created_at DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/machines', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM machines');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new machine
app.post('/api/machines', async (req, res) => {
    const name = normalizeText(req.body.name);
    const type = normalizeText(req.body.type);

    try {
        if (!name) {
            return res.status(400).json({ error: 'Machine name is required' });
        }

        if (name.length < 2 || name.length > 60) {
            return res.status(400).json({ error: 'Machine name must be between 2 and 60 characters' });
        }

        if (type && type.length > 60) {
            return res.status(400).json({ error: 'Machine type must be 60 characters or less' });
        }
        
        // Get the next ID
        const idResult = await pool.query('SELECT MAX(id) as max_id FROM machines');
        const nextId = (idResult.rows[0].max_id || 0) + 1;
        
        const result = await pool.query(
            'INSERT INTO machines (id, name, type) VALUES ($1, $2, $3) RETURNING *',
            [nextId, name, type || 'Unspecified']
        );
        res.status(201).json({ message: 'Machine created successfully', machine: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Machine name already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.put('/ticket/:id', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const result = await pool.query(
            'UPDATE maintenance_tickets SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE ticket_id = $2 RETURNING *',
            [status, id]
        );
        io.emit('ticket_updated', result.rows[0]);
        res.json({ message: 'Updated successfully', ticket: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// --- PLC DATA ENDPOINTS ---

// Get latest PLC readings for all machines
app.get('/api/plc/latest', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.name as machine_name, m.id as machine_id, pr.timestamp, pr.status_bits, pr.sensor_data
            FROM plc_latest pr
            JOIN machines m ON pr.machine_id = m.id
            ORDER BY m.id
        `);
        
        // If no data in database, return mock data for testing
        if (result.rows.length === 0) {
            const mockData = [
                { machine_name: 'Broyeur', machine_id: 1, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: 42, speed: 1500, status: 'ON', pressure: 2.1 } },
                { machine_name: 'Atomiseur', machine_id: 2, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: 38, speed: 1200, status: 'ON', pressure: 1.8 } },
                { machine_name: 'Presse', machine_id: 3, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: 45, speed: 1800, status: 'ON', pressure: 2.5 } },
                { machine_name: 'Séchoir', machine_id: 4, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: 65, speed: 800, status: 'ON', pressure: 1.2 } },
                { machine_name: 'Imprimante', machine_id: 5, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: 35, speed: 2000, status: 'ON', pressure: 1.5 } },
                { machine_name: 'Four', machine_id: 6, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: 180, speed: 600, status: 'ON', pressure: 0.8 } },
                { machine_name: 'Marpack', machine_id: 7, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: 28, speed: 900, status: 'ON', pressure: 1.0 } }
            ];
            res.json(mockData);
        } else {
            res.json(result.rows);
        }
    } catch (err) {
        console.error('Error fetching PLC data:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get PLC readings for a specific machine
app.get('/api/plc/machine/:machineId', async (req, res) => {
    const { machineId } = req.params;
    try {
        const result = await pool.query(`
            SELECT m.name as machine_name, pr.timestamp, pr.status_bits, pr.sensor_data
            FROM plc_readings pr
            JOIN machines m ON pr.machine_id = m.id
            WHERE pr.machine_id = $1
            ORDER BY pr.timestamp DESC
            LIMIT 50
        `, [machineId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching machine PLC data:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get PLC alerts
app.get('/api/plc/alerts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.name as machine_name, pa.timestamp, pa.level, pa.message, pa.status_code
            FROM plc_alerts pa
            JOIN machines m ON pa.machine_id = m.id
            ORDER BY pa.timestamp DESC
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching PLC alerts:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Real-time PLC data broadcasting
setInterval(async () => {
    try {
        const result = await pool.query(`
            SELECT m.name as machine_name, m.id as machine_id, pr.timestamp, pr.status_bits, pr.sensor_data
            FROM plc_latest pr
            JOIN machines m ON pr.machine_id = m.id
            ORDER BY m.id
        `);

        let plcData;
        if (result.rows.length === 0) {
            // Use mock data for testing when database is empty
            const mockData = [
                { machine_name: 'Broyeur', machine_id: 1, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: Math.floor(Math.random() * 10) + 35, speed: Math.floor(Math.random() * 500) + 1200, status: 'ON', pressure: (Math.random() * 1.5 + 1).toFixed(1) } },
                { machine_name: 'Atomiseur', machine_id: 2, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: Math.floor(Math.random() * 8) + 32, speed: Math.floor(Math.random() * 400) + 1000, status: 'ON', pressure: (Math.random() * 1.2 + 1.5).toFixed(1) } },
                { machine_name: 'Presse', machine_id: 3, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: Math.floor(Math.random() * 12) + 38, speed: Math.floor(Math.random() * 600) + 1400, status: 'ON', pressure: (Math.random() * 2 + 1.8).toFixed(1) } },
                { machine_name: 'Séchoir', machine_id: 4, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: Math.floor(Math.random() * 15) + 55, speed: Math.floor(Math.random() * 300) + 700, status: 'ON', pressure: (Math.random() * 0.8 + 0.9).toFixed(1) } },
                { machine_name: 'Imprimante', machine_id: 5, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: Math.floor(Math.random() * 6) + 30, speed: Math.floor(Math.random() * 800) + 1600, status: 'ON', pressure: (Math.random() * 1 + 1.2).toFixed(1) } },
                { machine_name: 'Four', machine_id: 6, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: Math.floor(Math.random() * 20) + 160, speed: Math.floor(Math.random() * 200) + 500, status: 'ON', pressure: (Math.random() * 0.5 + 0.6).toFixed(1) } },
                { machine_name: 'Marpack', machine_id: 7, timestamp: new Date(), status_bits: 1, sensor_data: { temperature: Math.floor(Math.random() * 5) + 25, speed: Math.floor(Math.random() * 400) + 700, status: 'ON', pressure: (Math.random() * 0.8 + 0.8).toFixed(1) } }
            ];
            plcData = mockData.map(row => ({
                machine_id: row.machine_id,
                machine_name: row.machine_name,
                data: row.sensor_data,
                timestamp: row.timestamp,
                status_bits: row.status_bits
            }));
        } else {
            plcData = result.rows.map(row => ({
                machine_id: row.machine_id,
                machine_name: row.machine_name,
                data: row.sensor_data,
                timestamp: row.timestamp,
                status_bits: row.status_bits
            }));
        }

        io.emit('factory_live_data', plcData);

        // Also broadcast recent alerts
        try {
            const alertResult = await pool.query(`
                SELECT m.name as machine_name, pa.timestamp, pa.level, pa.message, pa.status_code
                FROM plc_alerts pa
                JOIN machines m ON pa.machine_id = m.id
                WHERE pa.timestamp > NOW() - INTERVAL '30 seconds'
                ORDER BY pa.timestamp DESC
                LIMIT 10
            `);

            if (alertResult.rows.length > 0) {
                alertResult.rows.forEach(alert => {
                    io.emit('plc_alert', alert);
                });
            }
        } catch (alertErr) {
            console.error('Error broadcasting alerts:', alertErr);
        }
    } catch (err) {
        console.error('Error broadcasting PLC data:', err);
    }
}, 2000); // Broadcast every 2 seconds

const PORT = process.env.SERVER_PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server active on port ${PORT}`));