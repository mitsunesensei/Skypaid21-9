// SkyParty Backend Server
// Run with: node server.js

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3003;

// Database connection
console.log('🔍 DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/skyparty'
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Data directory (fallback for local storage)
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
}

// Database helper functions
class Database {
    static async read(filename) {
        try {
            const filePath = path.join(DATA_DIR, `${filename}.json`);
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.log(`File ${filename}.json not found, returning empty data`);
            return {};
        }
    }

    static async write(filename, data) {
        try {
            const filePath = path.join(DATA_DIR, `${filename}.json`);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error(`Error writing ${filename}.json:`, error);
            return false;
        }
    }

    static async append(filename, key, newData) {
        const existingData = await this.read(filename);
        if (!existingData[key]) {
            existingData[key] = [];
        }
        existingData[key].push({
            ...newData,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString()
        });
        return await this.write(filename, existingData);
    }
}

// User Management Routes
app.post('/api/users/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Basic validation
        if (!username || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username, email, and password are required' 
            });
        }

        const users = await Database.read('users');
        
        // Check if user already exists
        if (users[email]) {
            return res.status(409).json({ 
                success: false, 
                error: 'User already exists' 
            });
        }

        // Check if username is taken
        const existingUsername = Object.values(users).find(user => user.username === username);
        if (existingUsername) {
            return res.status(409).json({ 
                success: false, 
                error: 'Username already taken' 
            });
        }

        // Create user
        const user = {
            id: crypto.randomUUID(),
            username,
            email,
            gameCredits: 150,
            currentCharacter: 'kitty',
            ownedCharacters: ['kitty'],
            registeredAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            activated: false,
            activationCode: null
        };

        users[email] = user;
        await Database.write('users', users);

        // Initialize user data collections
        await Database.write(`inventory_${user.id}`, []);
        await Database.write(`mailbox_${user.id}`, []);
        await Database.write(`conversations_${user.id}`, []);

        res.json({ 
            success: true, 
            user: { 
                id: user.id,
                username: user.username,
                email: user.email,
                gameCredits: user.gameCredits 
            } 
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const users = await Database.read('users');
        const user = users[email];
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid credentials' 
            });
        }

        // Update last login
        user.lastLogin = new Date().toISOString();
        users[email] = user;
        await Database.write('users', users);

        res.json({ 
            success: true, 
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                gameCredits: user.gameCredits,
                currentCharacter: user.currentCharacter,
                ownedCharacters: user.ownedCharacters,
                activated: user.activated
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

app.get('/api/users/search', async (req, res) => {
    try {
        const { query } = req.query;
        
        console.log('🔍 User search request:', query);
        
        if (!query) {
            return res.json({ success: true, users: [] });
        }

        // Search PostgreSQL database for users
        const client = await pool.connect();
        try {
            // First try with currentCharacter column
            let result;
            try {
                result = await client.query(
                    'SELECT id, username, email, currentCharacter, created_at FROM users WHERE username ILIKE $1 ORDER BY username',
                    [`%${query}%`]
                );
            } catch (error) {
                // If currentCharacter column doesn't exist, fall back to basic query
                console.log('⚠️ currentCharacter column not found, using fallback query');
                result = await client.query(
                    'SELECT id, username, email, created_at FROM users WHERE username ILIKE $1 ORDER BY username',
                    [`%${query}%`]
                );
            }
            
            const users = result.rows.map(row => ({
                id: row.id,
                username: row.username,
                email: row.email,
                currentCharacter: row.currentcharacter || 'kitty', // Default to kitty if column doesn't exist
                createdAt: row.created_at
            }));
            
            console.log('✅ Found users in PostgreSQL:', users.length);
            res.json({ success: true, users: users });
            
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ User search error:', error);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// Debug endpoint to check all users in database
app.get('/api/debug/users', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT id, username, email, created_at FROM users ORDER BY created_at DESC');
            
            console.log('📊 All users in database:', result.rows.length);
            result.rows.forEach(user => {
                console.log(`👤 User: ${user.username} (${user.email}) - Created: ${user.created_at}`);
            });
            
            res.json({ 
                success: true, 
                totalUsers: result.rows.length,
                users: result.rows 
            });
            
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ Debug users error:', error);
        res.status(500).json({ success: false, error: 'Debug failed' });
    }
});

// Activation Routes
app.post('/api/activation/activate', async (req, res) => {
    try {
        const { email, activationCode } = req.body;
        
        const validCodes = [
            'SKYP-ARTY-2024-GOLD',
            'TEST-CODE-ABCD-1234',
            'DEMO-FULL-ACCE-XYZ',
            'PREM-IUMU-SER2-024',
            'VIPM-EMBE-RCOD-E123',
            'BETA-TEST-ER20-24',
            'EARL-YBIR-DSPE-CIAL',
            'FOUN-DER2-024-CODE',
            'GOLD-ENTI-CKET-CODE',
            'PLAT-INUM-ACCE-SS24'
        ];

        if (!validCodes.includes(activationCode)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid activation code' 
            });
        }

        const users = await Database.read('users');
        const user = users[email];
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        user.activated = true;
        user.activationCode = activationCode;
        user.activatedAt = new Date().toISOString();
        
        users[email] = user;
        await Database.write('users', users);

        res.json({ success: true, message: 'Activation successful' });

    } catch (error) {
        console.error('Activation error:', error);
        res.status(500).json({ success: false, error: 'Activation failed' });
    }
});

// Credits Management Routes
app.post('/api/credits/update', async (req, res) => {
    try {
        const { userId, amount, operation } = req.body; // operation: 'add' or 'subtract'
        
        const users = await Database.read('users');
        const user = Object.values(users).find(u => u.id === userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        if (operation === 'add') {
            user.gameCredits += amount;
        } else if (operation === 'subtract') {
            if (user.gameCredits < amount) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Insufficient credits' 
                });
            }
            user.gameCredits -= amount;
        }

        // Update user in database
        users[user.email] = user;
        await Database.write('users', users);

        // Log transaction
        const transactions = await Database.read('transactions');
        if (!transactions[userId]) {
            transactions[userId] = [];
        }
        transactions[userId].push({
            id: crypto.randomUUID(),
            amount: operation === 'add' ? amount : -amount,
            type: operation,
            timestamp: new Date().toISOString(),
            balance: user.gameCredits
        });
        await Database.write('transactions', transactions);

        res.json({ 
            success: true, 
            newBalance: user.gameCredits 
        });

    } catch (error) {
        console.error('Credits update error:', error);
        res.status(500).json({ success: false, error: 'Credits update failed' });
    }
});

// Character Management Routes
app.post('/api/characters/purchase', async (req, res) => {
    try {
        const { userId, characterId, characterData } = req.body;
        
        const users = await Database.read('users');
        const user = Object.values(users).find(u => u.id === userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        // Check if user has enough credits
        if (user.gameCredits < characterData.price) {
            return res.status(400).json({ 
                success: false, 
                error: 'Insufficient credits' 
            });
        }

        // Deduct credits and add character
        user.gameCredits -= characterData.price;
        if (!user.ownedCharacters.includes(characterId)) {
            user.ownedCharacters.push(characterId);
        }

        // Update user in database
        users[user.email] = user;
        await Database.write('users', users);

        // Add to inventory
        const inventory = await Database.read(`inventory_${userId}`);
        inventory.push({
            id: crypto.randomUUID(),
            type: 'character',
            characterId: characterId,
            name: characterData.name,
            icon: characterData.icon,
            description: characterData.description,
            price: characterData.price,
            acquiredDate: new Date().toISOString(),
            source: 'purchase'
        });
        await Database.write(`inventory_${userId}`, inventory);

        res.json({ 
            success: true, 
            newBalance: user.gameCredits,
            ownedCharacters: user.ownedCharacters 
        });

    } catch (error) {
        console.error('Character purchase error:', error);
        res.status(500).json({ success: false, error: 'Purchase failed' });
    }
});

app.post('/api/characters/select', async (req, res) => {
    try {
        const { userId, characterId } = req.body;
        
        const users = await Database.read('users');
        const user = Object.values(users).find(u => u.id === userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        // Check if user owns the character
        if (!user.ownedCharacters.includes(characterId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Character not owned' 
            });
        }

        user.currentCharacter = characterId;
        users[user.email] = user;
        await Database.write('users', users);

        res.json({ 
            success: true, 
            currentCharacter: characterId 
        });

    } catch (error) {
        console.error('Character selection error:', error);
        res.status(500).json({ success: false, error: 'Selection failed' });
    }
});

// Inventory Management Routes
app.get('/api/inventory/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const inventory = await Database.read(`inventory_${userId}`);
        
        res.json({ success: true, items: inventory });

    } catch (error) {
        console.error('Inventory fetch error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch inventory' });
    }
});

app.post('/api/inventory/add', async (req, res) => {
    try {
        const { userId, item } = req.body;
        
        const inventory = await Database.read(`inventory_${userId}`);
        inventory.push({
            ...item,
            id: crypto.randomUUID(),
            acquiredDate: new Date().toISOString()
        });
        await Database.write(`inventory_${userId}`, inventory);

        res.json({ success: true });

    } catch (error) {
        console.error('Inventory add error:', error);
        res.status(500).json({ success: false, error: 'Failed to add item' });
    }
});

// Messaging System Routes
// Get conversations for a user
app.get('/api/messages/conversations/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const client = await pool.connect();
        
        // Get conversations where user is a participant
        const conversationsQuery = `
            SELECT DISTINCT c.id, c.created_at, c.updated_at,
                   u1.username as participant1_username,
                   u2.username as participant2_username,
                   u1.id as participant1_id,
                   u2.id as participant2_id
            FROM conversations c
            LEFT JOIN users u1 ON c.participant1_id = u1.id
            LEFT JOIN users u2 ON c.participant2_id = u2.id
            WHERE c.participant1_id = $1 OR c.participant2_id = $1
            ORDER BY c.updated_at DESC
        `;
        
        const conversationsResult = await client.query(conversationsQuery, [userId]);
        
        // Get messages for each conversation
        const conversations = [];
        for (const conv of conversationsResult.rows) {
            const messagesQuery = `
                SELECT m.id, m.content, m.created_at, m.read_status,
                       u.username as sender_username, u.id as sender_id
                FROM messages m
                LEFT JOIN users u ON m.sender_id = u.id
                WHERE m.conversation_id = $1
                ORDER BY m.created_at ASC
            `;
            
            const messagesResult = await client.query(messagesQuery, [conv.id]);
            
            // Determine the other participant
            const otherParticipant = conv.participant1_id == userId ? 
                { id: conv.participant2_id, username: conv.participant2_username } :
                { id: conv.participant1_id, username: conv.participant1_username };
            
            conversations.push({
                id: conv.id,
                participants: [conv.participant1_username, conv.participant2_username],
                otherParticipant: otherParticipant.username,
                messages: messagesResult.rows.map(msg => ({
                    id: msg.id,
                    sender: msg.sender_username,
                    senderId: msg.sender_id,
                    content: msg.content,
                    timestamp: msg.created_at.toISOString(),
                    read: msg.read_status
                })),
                lastActivity: conv.updated_at.toISOString()
            });
        }
        
        client.release();
        res.json({ success: true, conversations });

    } catch (error) {
        console.error('Conversations fetch error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
    }
});

// Send a message
app.post('/api/messages/send', async (req, res) => {
    try {
        const { senderId, recipientId, content, conversationId } = req.body;
        const client = await pool.connect();
        
        // Get sender and recipient usernames
        const senderQuery = await client.query('SELECT username FROM users WHERE id = $1', [senderId]);
        const recipientQuery = await client.query('SELECT username FROM users WHERE id = $1', [recipientId]);
        
        if (senderQuery.rows.length === 0 || recipientQuery.rows.length === 0) {
            client.release();
            return res.status(400).json({ success: false, error: 'Invalid sender or recipient' });
        }
        
        const senderUsername = senderQuery.rows[0].username;
        const recipientUsername = recipientQuery.rows[0].username;
        
        // Ensure conversation exists
        let convId = conversationId;
        if (!convId) {
            // Create conversation ID from usernames
            convId = [senderUsername, recipientUsername].sort().join('_');
        }
        
        // Check if conversation exists, create if not
        const convCheck = await client.query('SELECT id FROM conversations WHERE id = $1', [convId]);
        if (convCheck.rows.length === 0) {
            await client.query(`
                INSERT INTO conversations (id, participant1_id, participant2_id)
                VALUES ($1, $2, $3)
            `, [convId, senderId, recipientId]);
        }
        
        // Insert message
        const messageQuery = `
            INSERT INTO messages (conversation_id, sender_id, recipient_id, content)
            VALUES ($1, $2, $3, $4)
            RETURNING id, created_at
        `;
        
        const messageResult = await client.query(messageQuery, [convId, senderId, recipientId, content]);
        const message = messageResult.rows[0];
        
        // Update conversation timestamp
        await client.query(`
            UPDATE conversations 
            SET updated_at = CURRENT_TIMESTAMP 
            WHERE id = $1
        `, [convId]);
        
        client.release();
        
        res.json({ 
            success: true, 
            message: {
                id: message.id,
                sender: senderUsername,
                senderId: senderId,
                recipient: recipientUsername,
                recipientId: recipientId,
                content: content,
                timestamp: message.created_at.toISOString(),
                read: false
            }
        });

    } catch (error) {
        console.error('Message send error:', error);
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
});

// Mailbox/Gifts System Routes
app.get('/api/mailbox/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const mailbox = await Database.read(`mailbox_${userId}`);
        
        res.json({ success: true, items: mailbox });

    } catch (error) {
        console.error('Mailbox fetch error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch mailbox' });
    }
});



// Game Statistics Routes
app.post('/api/games/play', async (req, res) => {
    try {
        const { userId, gameType, earnedCredits } = req.body;
        
        // Update user credits
        const result = await Database.read('/api/credits/update', {
            userId,
            amount: earnedCredits,
            operation: 'add'
        });

        // Log game session
        const gameSessions = await Database.read('game_sessions');
        if (!gameSessions[userId]) {
            gameSessions[userId] = [];
        }
        gameSessions[userId].push({
            id: crypto.randomUUID(),
            gameType,
            earnedCredits,
            playedAt: new Date().toISOString(),
            duration: Math.floor(Math.random() * 1800) + 300 // 5-35 minutes
        });
        await Database.write('game_sessions', gameSessions);

        res.json({ 
            success: true, 
            earnedCredits,
            newBalance: result.newBalance 
        });

    } catch (error) {
        console.error('Game play error:', error);
        res.status(500).json({ success: false, error: 'Failed to record game session' });
    }
});

// Analytics Routes
app.get('/api/admin/stats', async (req, res) => {
    try {
        const users = await Database.read('users');
        const transactions = await Database.read('transactions');
        const gameSessions = await Database.read('game_sessions');

        const stats = {
            totalUsers: Object.keys(users).length,
            activeUsers: Object.values(users).filter(user => {
                const lastLogin = new Date(user.lastLogin);
                const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                return lastLogin > weekAgo;
            }).length,
            activatedUsers: Object.values(users).filter(user => user.activated).length,
            totalTransactions: Object.values(transactions).flat().length,
            totalGameSessions: Object.values(gameSessions).flat().length,
            totalCreditsInCirculation: Object.values(users).reduce((sum, user) => sum + user.gameCredits, 0)
        };

        res.json({ success: true, stats });

    } catch (error) {
        console.error('Stats fetch error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch stats' });
    }
});

// Data backup and restore
app.get('/api/admin/backup', async (req, res) => {
    try {
        const files = await fs.readdir(DATA_DIR);
        const backup = {};
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filename = file.replace('.json', '');
                backup[filename] = await Database.read(filename);
            }
        }

        res.json({ success: true, backup });

    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ success: false, error: 'Backup failed' });
    }
});

app.post('/api/admin/restore', async (req, res) => {
    try {
        const { backup } = req.body;
        
        for (const [filename, data] of Object.entries(backup)) {
            await Database.write(filename, data);
        }

        res.json({ success: true, message: 'Data restored successfully' });

    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ success: false, error: 'Restore failed' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'SkyParty backend server is running',
        timestamp: new Date().toISOString()
    });
});

// ===== API ENDPOINTS =====

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'SkyParty API Server is running',
        timestamp: new Date().toISOString()
    });
});

// Register user
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        const client = await pool.connect();
        
        // Check if user already exists
        const existingUser = await client.query(
            'SELECT id FROM users WHERE username = $1 OR email = $2',
            [username, email]
        );
        
        if (existingUser.rows.length > 0) {
            client.release();
            return res.status(400).json({ success: false, message: 'Username or email already exists' });
        }
        
        // Hash password (simple hash for now)
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        
        // Insert new user
        const result = await client.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
            [username, email, passwordHash]
        );
        
        client.release();
        
        res.json({
            success: true,
            message: 'User registered successfully',
            userId: result.rows[0].id
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// Login user
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Missing username or password' });
        }
        
        const client = await pool.connect();
        
        // Find user
        const result = await client.query(
            'SELECT id, username, email, password_hash FROM users WHERE username = $1',
            [username]
        );
        
        if (result.rows.length === 0) {
            client.release();
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        
        if (user.password_hash !== passwordHash) {
            client.release();
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        // Update last login
        await client.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );
        
        client.release();
        
        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
});

// Get user data
app.get('/api/user/:userId/data', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const client = await pool.connect();
        
        const result = await client.query(
            'SELECT data_type, data_value FROM user_data WHERE user_id = $1',
            [userId]
        );
        
        client.release();
        
        // Convert to object format
        const userData = {};
        result.rows.forEach(row => {
            userData[row.data_type] = row.data_value;
        });
        
        res.json({
            success: true,
            data: userData
        });
        
    } catch (error) {
        console.error('Get user data error:', error);
        res.status(500).json({ success: false, message: 'Failed to get user data' });
    }
});

// Update user data
app.put('/api/user/:userId/data', async (req, res) => {
    try {
        const { userId } = req.params;
        const data = req.body;
        
        const client = await pool.connect();
        
        // Update currentCharacter in users table if provided
        if (data.currentCharacter) {
            try {
                await client.query(
                    'UPDATE users SET currentCharacter = $1 WHERE id = $2',
                    [data.currentCharacter, userId]
                );
                console.log(`✅ Updated currentCharacter to ${data.currentCharacter} for user ${userId}`);
            } catch (error) {
                console.log('⚠️ currentCharacter column not found, skipping character update:', error.message);
            }
        }
        
        // Update or insert each data type in user_data table
        for (const [dataType, dataValue] of Object.entries(data)) {
            // Skip currentCharacter as it's handled separately
            if (dataType === 'currentCharacter') continue;
            
            // Convert arrays/objects to proper JSON for JSONB storage
            const valueToStore = typeof dataValue === 'object' ? dataValue : dataValue;
            
            await client.query(
                `INSERT INTO user_data (user_id, data_type, data_value, updated_at) 
                 VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, data_type) 
                 DO UPDATE SET data_value = $3, updated_at = CURRENT_TIMESTAMP`,
                [userId, dataType, valueToStore]
            );
        }
        
        client.release();
        
        res.json({
            success: true,
            message: 'User data updated successfully'
        });
        
    } catch (error) {
        console.error('Update user data error:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            userId: req.params.userId,
            data: req.body
        });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update user data',
            error: error.message 
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Create database tables
async function createTables() {
    try {
        console.log('🔧 Creating database tables...');
        console.log('🔍 Attempting to connect to database...');
        
        const client = await pool.connect();
        console.log('✅ Database connection successful!');
        
        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                currentCharacter VARCHAR(50) DEFAULT 'kitty',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP
            )
        `);
        
        // Add currentCharacter column if it doesn't exist (migration)
        try {
            await client.query(`
                ALTER TABLE users ADD COLUMN IF NOT EXISTS currentCharacter VARCHAR(50) DEFAULT 'kitty'
            `);
            console.log('✅ Added currentCharacter column to users table');
        } catch (error) {
            console.log('⚠️ currentCharacter column already exists or error:', error.message);
        }
        
        // Create user_data table for game data
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_data (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                data_type VARCHAR(50) NOT NULL,
                data_value JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, data_type)
            )
        `);
        
        // Create conversations table
        await client.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id VARCHAR(255) PRIMARY KEY,
                participant1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                participant2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create messages table
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id VARCHAR(255) REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                read_status BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create characters table (master character definitions)
        await client.query(`
            CREATE TABLE IF NOT EXISTS characters (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                icon VARCHAR(10) NOT NULL,
                description TEXT,
                price INTEGER DEFAULT 0,
                rarity VARCHAR(20) DEFAULT 'common',
                category VARCHAR(50) DEFAULT 'default',
                unlock_level INTEGER DEFAULT 1,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create user_characters table (user's owned characters)
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_characters (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                character_id VARCHAR(50) REFERENCES characters(id) ON DELETE CASCADE,
                acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                acquired_via VARCHAR(20) DEFAULT 'purchase',
                quantity INTEGER DEFAULT 1,
                UNIQUE(user_id, character_id)
            )
        `);
        
        // Create character_inventory table (detailed inventory tracking)
        await client.query(`
            CREATE TABLE IF NOT EXISTS character_inventory (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                character_id VARCHAR(50) REFERENCES characters(id) ON DELETE CASCADE,
                item_name VARCHAR(100) NOT NULL,
                item_type VARCHAR(50) DEFAULT 'character',
                icon VARCHAR(10),
                description TEXT,
                price INTEGER DEFAULT 0,
                acquired_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                source VARCHAR(20) DEFAULT 'purchase',
                quantity INTEGER DEFAULT 1,
                metadata JSONB
            )
        `);
        
        
        // Create gifts table (new clean gift system)
        await client.query(`
            CREATE TABLE IF NOT EXISTS gifts (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                item_type VARCHAR(50) NOT NULL DEFAULT 'character',
                item_name VARCHAR(100) NOT NULL,
                item_icon VARCHAR(10),
                item_description TEXT,
                item_price INTEGER DEFAULT 0,
                message TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                claimed_at TIMESTAMP
            )
        `);
        await client.query(`
            INSERT INTO characters (id, name, icon, description, price, rarity, category) VALUES
            ('kitty', 'Kitty', '🐱', 'A cute and friendly kitty character. Perfect for beginners!', 0, 'common', 'starter'),
            ('dragon', 'Dragon', '🐉', 'A powerful dragon with mystical abilities.', 500, 'rare', 'fantasy'),
            ('robot', 'Robot', '🤖', 'An advanced AI robot companion.', 300, 'uncommon', 'tech'),
            ('ninja', 'Ninja', '🥷', 'A stealthy ninja warrior.', 400, 'uncommon', 'warrior'),
            ('wizard', 'Wizard', '🧙', 'A wise wizard with magical powers.', 600, 'rare', 'magic'),
            ('pirate', 'Pirate', '🏴‍☠️', 'A swashbuckling pirate adventurer.', 350, 'uncommon', 'adventure'),
            ('bear', 'Bear', '🐻', 'A strong and cuddly bear companion.', 250, 'common', 'animal'),
            ('unicorn', 'Unicorn', '🦄', 'A magical unicorn with healing powers.', 800, 'epic', 'fantasy'),
            ('rabbit', 'Rabbit', '🐰', 'A quick and agile rabbit friend.', 200, 'common', 'animal'),
            ('fox', 'Fox', '🦊', 'A clever and cunning fox.', 300, 'uncommon', 'animal'),
            ('owl', 'Owl', '🦉', 'A wise owl with night vision.', 400, 'uncommon', 'animal'),
            ('wolf', 'Wolf', '🐺', 'A loyal wolf pack leader.', 450, 'uncommon', 'animal')
            ON CONFLICT (id) DO NOTHING
        `);
        
        client.release();
        console.log('✅ Database tables created successfully!');
    } catch (error) {
        console.error('❌ Error creating tables:', error.message);
    }
}

// Character API endpoints
app.get('/api/characters', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query(`
            SELECT id, name, icon, description, price, rarity, category, unlock_level 
            FROM characters 
            WHERE is_active = TRUE 
            ORDER BY price ASC, name ASC
        `);
        client.release();
        
        res.json({ 
            success: true, 
            characters: result.rows 
        });
    } catch (error) {
        console.error('Error fetching characters:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch characters' });
    }
});

app.get('/api/user/:userId/characters', async (req, res) => {
    try {
        const userId = req.params.userId;
        const client = await pool.connect();
        
        const result = await client.query(`
            SELECT c.id, c.name, c.icon, c.description, c.price, c.rarity, c.category,
                   uc.acquired_at, uc.acquired_via, uc.quantity
            FROM user_characters uc
            JOIN characters c ON uc.character_id = c.id
            WHERE uc.user_id = $1 AND c.is_active = TRUE
            ORDER BY uc.acquired_at DESC
        `, [userId]);
        
        client.release();
        
        res.json({ 
            success: true, 
            characters: result.rows 
        });
    } catch (error) {
        console.error('Error fetching user characters:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch user characters' });
    }
});

app.post('/api/user/:userId/characters/:characterId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const characterId = req.params.characterId;
        const { acquired_via = 'purchase' } = req.body;
        
        const client = await pool.connect();
        
        // Check if user already owns this character
        const existing = await client.query(`
            SELECT id, quantity FROM user_characters 
            WHERE user_id = $1 AND character_id = $2
        `, [userId, characterId]);
        
        if (existing.rows.length > 0) {
            // Update quantity
            await client.query(`
                UPDATE user_characters 
                SET quantity = quantity + 1, acquired_at = CURRENT_TIMESTAMP
                WHERE user_id = $1 AND character_id = $2
            `, [userId, characterId]);
        } else {
            // Insert new character
            await client.query(`
                INSERT INTO user_characters (user_id, character_id, acquired_via)
                VALUES ($1, $2, $3)
            `, [userId, characterId, acquired_via]);
        }
        
        client.release();
        
        res.json({ 
            success: true, 
            message: 'Character added successfully' 
        });
    } catch (error) {
        console.error('Error adding character:', error);
        res.status(500).json({ success: false, error: 'Failed to add character' });
    }
});


// Clean Gift System API endpoints
app.post('/api/gifts/send', async (req, res) => {
    try {
        const { senderId, recipientId, itemType, itemData, message } = req.body;
        
        if (!senderId || !recipientId || !itemData) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }
        
        const client = await pool.connect();
        
        // Insert gift into database
        const result = await client.query(`
            INSERT INTO gifts (sender_id, recipient_id, item_type, item_name, item_icon, item_description, item_price, message)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, created_at
        `, [
            senderId, 
            recipientId, 
            itemType, 
            itemData.name, 
            itemData.icon, 
            itemData.description, 
            itemData.price, 
            message || ''
        ]);
        
        client.release();
        
        res.json({ 
            success: true, 
            giftId: result.rows[0].id,
            createdAt: result.rows[0].created_at,
            message: 'Gift sent successfully' 
        });
    } catch (error) {
        console.error('Error sending gift:', error);
        res.status(500).json({ success: false, error: 'Failed to send gift' });
    }
});

app.get('/api/user/:userId/gifts', async (req, res) => {
    try {
        const userId = req.params.userId;
        const client = await pool.connect();
        
        const result = await client.query(`
            SELECT 
                g.id,
                g.sender_id,
                g.recipient_id,
                g.item_type,
                g.message,
                g.status,
                g.created_at,
                g.claimed_at,
                u.username as sender_username,
                r.username as recipient_username,
                JSON_BUILD_OBJECT(
                    'name', g.item_name,
                    'icon', g.item_icon,
                    'description', g.item_description,
                    'price', g.item_price
                ) as item_data
            FROM gifts g
            JOIN users u ON g.sender_id = u.id
            JOIN users r ON g.recipient_id = r.id
            WHERE g.recipient_id = $1 AND g.status = 'pending'
            ORDER BY g.created_at DESC
        `, [userId]);
        
        client.release();
        
        res.json({ 
            success: true, 
            gifts: result.rows 
        });
    } catch (error) {
        console.error('Error fetching gifts:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch gifts' });
    }
});

app.post('/api/gifts/:giftId/claim', async (req, res) => {
    try {
        const giftId = req.params.giftId;
        const { userId } = req.body;
        
        const client = await pool.connect();
        
        // Get gift details
        const giftResult = await client.query(`
            SELECT * FROM gifts WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
        `, [giftId, userId]);
        
        if (giftResult.rows.length === 0) {
            client.release();
            return res.status(404).json({ success: false, error: 'Gift not found or already claimed' });
        }
        
        const gift = giftResult.rows[0];
        
        // Update gift status
        await client.query(`
            UPDATE gifts 
            SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [giftId]);
        
        // Add character to user's inventory if it's a character gift
        if (gift.item_type === 'character') {
            // Find character ID
            const characterResult = await client.query(`
                SELECT id FROM characters WHERE name = $1
            `, [gift.item_name]);
            
            if (characterResult.rows.length > 0) {
                const characterId = characterResult.rows[0].id;
                
                // Add to user_characters
                await client.query(`
                    INSERT INTO user_characters (user_id, character_id, acquired_via)
                    VALUES ($1, $2, 'gift')
                    ON CONFLICT (user_id, character_id) 
                    DO UPDATE SET quantity = user_characters.quantity + 1
                `, [userId, characterId]);
            }
        }
        
        client.release();
        
        res.json({ 
            success: true, 
            message: 'Gift claimed successfully' 
        });
    } catch (error) {
        console.error('Error claiming gift:', error);
        res.status(500).json({ success: false, error: 'Failed to claim gift' });
    }
});

app.post('/api/gifts/:giftId/reject', async (req, res) => {
    try {
        const giftId = req.params.giftId;
        const { userId } = req.body;
        
        const client = await pool.connect();
        
        // Update gift status to rejected
        const result = await client.query(`
            UPDATE gifts 
            SET status = 'rejected'
            WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
        `, [giftId, userId]);
        
        client.release();
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Gift not found or already processed' });
        }
        
        res.json({ 
            success: true, 
            message: 'Gift rejected successfully' 
        });
    } catch (error) {
        console.error('Error rejecting gift:', error);
        res.status(500).json({ success: false, error: 'Failed to reject gift' });
    }
});
async function startServer() {
    await ensureDataDir();
    await createTables();
    app.listen(PORT, () => {
        console.log(`🎮 SkyParty Backend Server running on port ${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
        console.log(`📁 Data directory: ${DATA_DIR}`);
        console.log(`🗄️ Database: Connected to PostgreSQL`);
    });
}

startServer().catch(console.error);

module.exports = app;
