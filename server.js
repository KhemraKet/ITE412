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

// Initialize Database (Railway supports local file creation in standard web services)
const db = new sqlite3.Database('./payments_chain.db', (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite payments database.');
        initDatabase();
    }
});

function initDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        cryptoAsset TEXT,
        recipientAddress TEXT,
        amount TEXT,
        memo TEXT,
        nonce INTEGER,
        prevHash TEXT,
        hash TEXT
    )`, (err) => {
        if (!err) {
            db.get(`SELECT COUNT(*) as count FROM payments`, (err, row) => {
                if (row.count === 0) {
                    const timestamp = new Date().toISOString();
                    const cryptoAsset = "SYS";
                    const recipientAddress = "0xGenesisRootWallet0000000000000000";
                    const amount = "0.00";
                    const memo = "Genesis Payment Block";
                    const nonce = 0;
                    const prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
                    
                    const stringToHash = 1 + timestamp + cryptoAsset + recipientAddress + amount + memo + nonce + prevHash;
                    const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');

                    db.run(`INSERT INTO payments (timestamp, cryptoAsset, recipientAddress, amount, memo, nonce, prevHash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [timestamp, cryptoAsset, recipientAddress, amount, memo, nonce, prevHash, hash]);
                }
            });
        }
    });
}

// API: Get all payment blocks
app.get('/api/payments', (req, res) => {
    db.all(`SELECT * FROM payments ORDER BY id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ chain: rows });
    });
});

// API: Create payment request & mine block
app.post('/api/create-payment', (req, res) => {
    const { cryptoAsset, recipientAddress, amount, memo } = req.body;
    if (!cryptoAsset || !recipientAddress || !amount) {
        return res.status(400).json({ error: "Missing required payment fields." });
    }

    db.get(`SELECT * FROM payments ORDER BY id DESC LIMIT 1`, [], (err, lastBlock) => {
        if (err || !lastBlock) return res.status(500).json({ error: "Chain error." });

        const newId = lastBlock.id + 1;
        const timestamp = new Date().toISOString();
        const prevHash = lastBlock.hash;
        let nonce = 0;

        let stringToHash = newId + timestamp + cryptoAsset + recipientAddress + amount + (memo || '') + nonce + prevHash;
        let hash = crypto.createHash('sha256').update(stringToHash).digest('hex');

        // Proof-of-Work difficulty simulation
        while (!hash.startsWith("00")) {
            nonce++;
            stringToHash = newId + timestamp + cryptoAsset + recipientAddress + amount + (memo || '') + nonce + prevHash;
            hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
        }

        db.run(`INSERT INTO payments (timestamp, cryptoAsset, recipientAddress, amount, memo, nonce, prevHash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [timestamp, cryptoAsset, recipientAddress, amount, memo || '', nonce, prevHash, hash], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Payment block successfully mined and logged!", blockId: newId, hash });
            });
    });
});

app.listen(PORT, () => {
    console.log(`Payment Server running on port ${PORT}`);
});