const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// SECURE PASSWORD FOR DOCTOR/ADMIN VIEW
const MASTER_DECRYPTION_PASSWORD = "DoctorSecure123!";

const ENCRYPTION_KEY = crypto.scryptSync('HospitalSecurePassphrase2026!', 'salt', 32);
const IV_LENGTH = 16;

function encryptData(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decryptData(text) {
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        return "[DECRYPTION FAILED]";
    }
}

// Initialize Database
const db = new sqlite3.Database('./hospital_chain.db', (err) => {
    if (!err) initHospitalDatabase();
});

function initHospitalDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        patientName TEXT,
        encryptedPayload TEXT,
        nonce INTEGER,
        prevHash TEXT,
        hash TEXT
    )`, (err) => {
        if (!err) {
            db.get(`SELECT COUNT(*) as count FROM records`, (err, row) => {
                if (row.count === 0) {
                    const timestamp = new Date().toISOString();
                    const patientName = "System Genesis";
                    const encryptedPayload = encryptData("Hospital Network Initialized - Secure EHR Vault Active");
                    const nonce = 0;
                    const prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
                    const stringToHash = 1 + timestamp + patientName + encryptedPayload + nonce + prevHash;
                    const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
                    db.run(`INSERT INTO records (timestamp, patientName, encryptedPayload, nonce, prevHash, hash) VALUES (?, ?, ?, ?, ?, ?)`,
                        [timestamp, patientName, encryptedPayload, nonce, prevHash, hash]);
                }
            });
        }
    });
}

// API: Get records (optionally decrypted if password matches)
app.post('/api/records', (req, res) => {
    const { password } = req.body;
    const isAuthorized = (password === MASTER_DECRYPTION_PASSWORD);

    db.all(`SELECT * FROM records ORDER BY id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const processedRows = rows.map(row => ({
            ...row,
            decryptedData: isAuthorized ? decryptData(row.encryptedPayload) : "🔒 [LOCKED: Enter password in Page 3 to view decrypted clinical notes]"
        }));

        res.json({ chain: processedRows, isAuthorized });
    });
});

// API: Patient Data Submission Form
app.post('/api/add-record', (req, res) => {
    const { patientName, age, gender, medicalNotes } = req.body;
    if (!patientName || !medicalNotes) {
        return res.status(400).json({ error: "Patient name and notes are required." });
    }

    const fullRecordPayload = `Age: ${age || 'N/A'}, Gender: ${gender || 'N/A'} | Notes: ${medicalNotes}`;

    db.get(`SELECT * FROM records ORDER BY id DESC LIMIT 1`, [], (err, lastBlock) => {
        if (err || !lastBlock) return res.status(500).json({ error: "Chain error." });

        const newId = lastBlock.id + 1;
        const timestamp = new Date().toISOString();
        const encryptedPayload = encryptData(fullRecordPayload);
        const prevHash = lastBlock.hash;
        let nonce = 0;

        let stringToHash = newId + timestamp + patientName + encryptedPayload + nonce + prevHash;
        let hash = crypto.createHash('sha256').update(stringToHash).digest('hex');

        while (!hash.startsWith("00")) {
            nonce++;
            stringToHash = newId + timestamp + patientName + encryptedPayload + nonce + prevHash;
            hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
        }

        db.run(`INSERT INTO records (timestamp, patientName, encryptedPayload, nonce, prevHash, hash) VALUES (?, ?, ?, ?, ?, ?)`,
            [timestamp, patientName, encryptedPayload, nonce, prevHash, hash], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Patient data securely encrypted and added to blockchain!" });
            });
    });
});

// API: Chain Verification
app.get('/api/verify', (req, res) => {
    db.all(`SELECT * FROM records ORDER BY id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        let isValid = true;
        let errorDetails = "";

        for (let i = 0; i < rows.length; i++) {
            const current = rows[i];
            const stringToHash = current.id + current.timestamp + current.patientName + current.encryptedPayload + current.nonce + current.prevHash;
            const recomputed = crypto.createHash('sha256').update(stringToHash).digest('hex');

            if (current.hash !== recomputed) {
                isValid = false;
                errorDetails = `Tampering detected at Record #${current.id}!`;
                break;
            }
            if (i > 0 && current.prevHash !== rows[i - 1].hash) {
                isValid = false;
                errorDetails = `Chain broken at Record #${current.id}!`;
                break;
            }
        }
        res.json({ isValid, errorDetails });
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
