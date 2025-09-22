const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Database connection error:', err);
});

// Create tables
async function createTables() {
    const client = await pool.connect();
    
    try {
        // Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                currentCharacter VARCHAR(50) DEFAULT 'kitty',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Characters table
        await client.query(`
            CREATE TABLE IF NOT EXISTS characters (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL,
                icon VARCHAR(10) NOT NULL,
                price INTEGER NOT NULL DEFAULT 0,
                description TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // User characters table (inventory)
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_characters (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
                quantity INTEGER DEFAULT 1,
                acquired_via VARCHAR(50) DEFAULT 'purchase',
                acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, character_id)
            )
        `);

        // User data table (for storing game credits, etc.)
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

        // Conversations table
        await client.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                user1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                user2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user1_id, user2_id)
            )
        `);

        // Messages table
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Gifts table
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

        console.log('✅ Database tables created successfully');

        // Insert default characters
        await client.query(`
            INSERT INTO characters (name, icon, price, description) VALUES
            ('kitty', '🐱', 0, 'A cute and friendly kitty character. Perfect for beginners!'),
            ('dragon', '🐉', 500, 'A powerful dragon with mystical abilities.'),
            ('robot', '🤖', 300, 'An advanced AI robot companion.'),
            ('ninja', '🥷', 400, 'A stealthy ninja warrior.'),
            ('wizard', '🧙', 600, 'A wise wizard with magical powers.'),
            ('pirate', '🏴‍☠️', 450, 'A swashbuckling pirate adventurer.'),
            ('bear', '🐻', 350, 'A strong and protective bear character.'),
            ('unicorn', '🦄', 700, 'A magical unicorn with healing powers.'),
            ('rabbit', '🐰', 200, 'A quick and energetic rabbit character.'),
            ('fox', '🦊', 300, 'A clever and agile fox character.'),
            ('owl', '🦉', 400, 'A wise and mysterious owl character.'),
            ('wolf', '🐺', 450, 'A loyal wolf pack leader.')
            ON CONFLICT (name) DO NOTHING
        `);

        console.log('✅ Default characters inserted');

    } catch (error) {
        console.error('❌ Error creating tables:', error);
    } finally {
        client.release();
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ success: true, message: 'SkyParty API is running!' });
});

// User registration
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username, email, and password are required'
            });
        }

        const client = await pool.connect();

        // Check if user already exists
        const existingUser = await client.query(
            'SELECT id FROM users WHERE username = $1 OR email = $2',
            [username, email]
        );

        if (existingUser.rows.length > 0) {
            client.release();
            return res.status(400).json({
                success: false,
                error: 'Username or email already exists'
            });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user
        const result = await client.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
            [username, email, passwordHash]
        );

        const newUser = result.rows[0];

        // Give user the default kitty character
        await client.query(
            'INSERT INTO user_characters (user_id, character_id, acquired_via) VALUES ($1, (SELECT id FROM characters WHERE name = $2), $3)',
            [newUser.id, 'kitty', 'default']
        );

        // Initialize user data with default credits
        await client.query(
            'INSERT INTO user_data (user_id, data_type, data_value) VALUES ($1, $2, $3)',
            [newUser.id, 'gameCredits', 1000]
        );

        client.release();

        res.json({
            success: true,
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email
            },
            message: 'User registered successfully'
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to register user'
        });
    }
});

// User login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        const client = await pool.connect();

        // Find user by username or email
        const result = await client.query(
            'SELECT id, username, email, password_hash FROM users WHERE username = $1 OR email = $1',
            [username]
        );

        if (result.rows.length === 0) {
            client.release();
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        const user = result.rows[0];

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            client.release();
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        client.release();

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            },
            message: 'Login successful'
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to login'
        });
    }
});

// Get all characters
app.get('/api/characters', async (req, res) => {
    try {
        const client = await pool.connect();

        const result = await client.query(
            'SELECT id, name, icon, price, description FROM characters WHERE is_active = true ORDER BY price ASC'
        );

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

// Get user's owned characters
app.get('/api/user/:userId/characters', async (req, res) => {
    try {
        const userId = req.params.userId;
        const client = await pool.connect();

        const result = await client.query(`
            SELECT 
                uc.character_id,
                c.name,
                c.icon,
                c.price,
                c.description,
                uc.quantity,
                uc.acquired_via,
                uc.acquired_at
            FROM user_characters uc
            JOIN characters c ON uc.character_id = c.id
            WHERE uc.user_id = $1
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

// Add character to user's inventory
app.post('/api/user/:userId/characters/:characterId', async (req, res) => {
    try {
        const { userId, characterId } = req.params;
        const { acquired_via = 'purchase' } = req.body;

        const client = await pool.connect();

        // Check if character exists
        const characterResult = await client.query(
            'SELECT id FROM characters WHERE name = $1 OR id = $1',
            [characterId]
        );

        if (characterResult.rows.length === 0) {
            client.release();
            return res.status(404).json({ success: false, error: 'Character not found' });
        }

        const characterIdNum = characterResult.rows[0].id;

        // Add character to user's inventory
        await client.query(`
            INSERT INTO user_characters (user_id, character_id, acquired_via)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, character_id)
            DO UPDATE SET quantity = user_characters.quantity + 1
        `, [userId, characterIdNum, acquired_via]);

        client.release();

        res.json({
            success: true,
            message: 'Character added to inventory'
        });

    } catch (error) {
        console.error('Error adding character:', error);
        res.status(500).json({ success: false, error: 'Failed to add character' });
    }
});

// Get user data
app.get('/api/user/:userId/data', async (req, res) => {
    try {
        const userId = req.params.userId;
        const client = await pool.connect();

        // Get current character from users table
        const userResult = await client.query(
            'SELECT currentCharacter FROM users WHERE id = $1',
            [userId]
        );

        // Get other user data from user_data table
        const dataResult = await client.query(
            'SELECT data_type, data_value FROM user_data WHERE user_id = $1',
            [userId]
        );

        client.release();

        const userData = {};
        
        // Add current character
        if (userResult.rows.length > 0) {
            userData.currentCharacter = userResult.rows[0].currentcharacter;
        }

        // Add other data
        dataResult.rows.forEach(row => {
            userData[row.data_type] = row.data_value;
        });

        res.json({
            success: true,
            data: userData
        });

    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch user data' });
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

// Search users
app.get('/api/users/search', async (req, res) => {
    try {
        const { query } = req.query;

        if (!query || query.trim() === '') {
            return res.json({ success: true, users: [] });
        }

        const client = await pool.connect();

        const result = await client.query(`
            SELECT 
                u.id,
                u.username,
                u.email,
                u.currentCharacter,
                c.icon as characterIcon
            FROM users u
            LEFT JOIN characters c ON u.currentCharacter = c.name
            WHERE u.username ILIKE $1 OR u.email ILIKE $1
            ORDER BY u.username
            LIMIT 20
        `, [`%${query}%`]);

        client.release();

        res.json({
            success: true,
            users: result.rows
        });

    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ success: false, error: 'Failed to search users' });
    }
});

// Get or create conversation
app.get('/api/conversations/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const client = await pool.connect();

        const result = await client.query(`
            SELECT 
                c.id,
                c.user1_id,
                c.user2_id,
                c.created_at,
                c.updated_at,
                u1.username as user1_username,
                u2.username as user2_username
            FROM conversations c
            JOIN users u1 ON c.user1_id = u1.id
            JOIN users u2 ON c.user2_id = u2.id
            WHERE c.user1_id = $1 OR c.user2_id = $1
            ORDER BY c.updated_at DESC
        `, [userId]);

        client.release();

        res.json({
            success: true,
            conversations: result.rows
        });

    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
    }
});

// Create conversation
app.post('/api/conversations', async (req, res) => {
    try {
        const { user1Id, user2Id } = req.body;

        if (!user1Id || !user2Id) {
            return res.status(400).json({
                success: false,
                error: 'Both user IDs are required'
            });
        }

        const client = await pool.connect();

        // Check if conversation already exists
        const existingResult = await client.query(
            'SELECT id FROM conversations WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
            [user1Id, user2Id]
        );

        if (existingResult.rows.length > 0) {
            client.release();
            return res.json({
                success: true,
                conversationId: existingResult.rows[0].id,
                message: 'Conversation already exists'
            });
        }

        // Create new conversation
        const result = await client.query(
            'INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING id',
            [user1Id, user2Id]
        );

        client.release();

        res.json({
            success: true,
            conversationId: result.rows[0].id,
            message: 'Conversation created successfully'
        });

    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).json({ success: false, error: 'Failed to create conversation' });
    }
});

// Get messages for a conversation
app.get('/api/messages/conversations/:conversationId', async (req, res) => {
    try {
        const conversationId = req.params.conversationId;
        const client = await pool.connect();

        const result = await client.query(`
            SELECT 
                m.id,
                m.sender_id,
                m.content,
                m.created_at,
                u.username as sender_username
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1
            ORDER BY m.created_at ASC
        `, [conversationId]);

        client.release();

        res.json({
            success: true,
            messages: result.rows
        });

    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch messages' });
    }
});

// Send message
app.post('/api/messages/send', async (req, res) => {
    try {
        const { conversationId, senderId, content } = req.body;

        if (!conversationId || !senderId || !content) {
            return res.status(400).json({
                success: false,
                error: 'Conversation ID, sender ID, and content are required'
            });
        }

        const client = await pool.connect();

        // Insert message
        const result = await client.query(
            'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, created_at',
            [conversationId, senderId, content]
        );

        // Update conversation timestamp
        await client.query(
            'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [conversationId]
        );

        client.release();

        res.json({
            success: true,
            message: {
                id: result.rows[0].id,
                conversationId,
                senderId,
                content,
                createdAt: result.rows[0].created_at
            }
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
});

// Gift system endpoints
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

// Initialize database and start server
async function startServer() {
    try {
        await createTables();
        
        app.listen(PORT, () => {
            console.log(`🚀 SkyParty API Server running on port ${PORT}`);
            console.log(`📊 Database connected successfully`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
