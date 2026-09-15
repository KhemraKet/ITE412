const express = require('express');
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const MASTER_DECRYPTION_PASSWORD = "12345";
const ENCRYPTION_KEY = crypto.scryptSync('HospitalSecurePassphrase2026!', 'salt', 32);
const IV_LENGTH = 16;
const DB_FILE = path.join(__dirname, 'blockchain.json');

// Encryption & Decryption Helpers
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

// Load or Initialize Blockchain JSON Storage
function getChain() {
    if (!fs.existsSync(DB_FILE)) {
        const timestamp = new Date().toISOString();
        const patientName = "System Genesis";
        const encryptedPayload = encryptData("Hospital Network Initialized - Secure EHR Vault Active");
        const nonce = 0;
        const prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
        const stringToHash = 1 + timestamp + patientName + encryptedPayload + nonce + prevHash;
        const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');

        const genesisBlock = [{ id: 1, timestamp, patientName, encryptedPayload, nonce, prevHash, hash }];
        fs.writeFileSync(DB_FILE, JSON.stringify(genesisBlock, null, 2));
        return genesisBlock;
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

function saveChain(chain) {
    fs.writeFileSync(DB_FILE, JSON.stringify(chain, null, 2));
}

// API: Get records (decrypted if password matches)
app.post('/api/records', (req, res) => {
    const { password } = req.body;
    const isAuthorized = (password === MASTER_DECRYPTION_PASSWORD);
    const chain = getChain();

    const processedRows = chain.map(row => ({
        ...row,
        decryptedData: isAuthorized ? decryptData(row.encryptedPayload) : "🔒 [LOCKED: Enter password '12345' in Page 3 to view decrypted clinical notes]"
    }));

    res.json({ chain: processedRows, isAuthorized });
});

// API: Patient Data Submission Form
app.post('/api/add-record', (req, res) => {
    const { patientName, age, gender, medicalNotes } = req.body;
    if (!patientName || !medicalNotes) {
        return res.status(400).json({ error: "Patient name and notes are required." });
    }

    const chain = getChain();
    const lastBlock = chain[chain.length - 1];
    
    const newId = lastBlock.id + 1;
    const timestamp = new Date().toISOString();
    const fullRecordPayload = `Age: ${age || 'N/A'}, Gender: ${gender || 'N/A'} | Notes: ${medicalNotes}`;
    const encryptedPayload = encryptData(fullRecordPayload);
    const prevHash = lastBlock.hash;
    let nonce = 0;

    let stringToHash = newId + timestamp + patientName + encryptedPayload + nonce + prevHash;
    let hash = crypto.createHash('sha256').update(stringToHash).digest('hex');

    // Proof-of-Work mining difficulty loop
    while (!hash.startsWith("00")) {
        nonce++;
        stringToHash = newId + timestamp + patientName + encryptedPayload + nonce + prevHash;
        hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
    }

    const newBlock = { id: newId, timestamp, patientName, encryptedPayload, nonce, prevHash, hash };
    chain.push(newBlock);
    saveChain(chain);

    res.json({ message: "Patient data securely encrypted and added to blockchain!" });
});

// API: Chain Verification
app.get('/api/verify', (req, res) => {
    const chain = getChain();
    let isValid = true;
    let errorDetails = "";

    for (let i = 0; i < chain.length; i++) {
        const current = chain[i];
        const stringToHash = current.id + current.timestamp + current.patientName + current.encryptedPayload + current.nonce + current.prevHash;
        const recomputed = crypto.createHash('sha256').update(stringToHash).digest('hex');

        if (current.hash !== recomputed) {
            isValid = false;
            errorDetails = `Tampering detected at Record #${current.id}!`;
            break;
        }
        if (i > 0 && current.prevHash !== chain[i - 1].hash) {
            isValid = false;
            errorDetails = `Chain broken at Record #${current.id}!`;
            break;
        }
    }
    res.json({ isValid, errorDetails });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
