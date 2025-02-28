import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import ollama from 'ollama';
import axios from 'axios';

// Define interfaces for our data structures
interface Author {
  id: string;
  username?: string;
  globalName?: string;
  avatar?: string;
  clan?: string;
  discriminator?: string;
  primary_guild?: string;
  publicFlags?: number;
  avatarDecorationData?: string;
}

interface Message {
  id: string;
  channelId: string;
  message_timestamp: string;
  content?: string;
  author_id?: string;
  username?: string;
  avatar?: string;
  globalName?: string;
  created_at?: string;
  attachments?: any[];
  embeds?: any[];
  components?: any[];
  member?: any;
  mentions?: any[];
  message_reference?: any;
  referenced_message?: any;
  guild_id?: string;
  edited_timestamp?: string;
  flags?: number;
  nonce?: string;
  pinned?: boolean;
  tts?: boolean;
  type?: number;
  author?: Author;
}

interface MessageContext {
  message: Message;
  channel_id: string;
  context_messages: Message[];
  context_message_count: number;
}

interface ResultsMap {
  [key: string]: any;
}

const app = express();
const port = 3000;

app.use(cors({
  origin: ['https://discord.com', 'https://discordapp.com', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Open (or create) the SQLite database
const db = new sqlite3.Database('./messages.db', (err) => {
  if (err) return console.error('Error opening database:', err.message);
  console.log('Connected to the SQLite database.');
});

async function getChatLog(messageId: string): Promise<string[]> {
    // Combine context messages and the main message into one array, with the main message at the end


    try {
      const messages = await getMessageContext(messageId) as MessageContext;


      console.log(messages);
      // Sort messages by timestamp (using the ISO timestamp from message_timestamp)
      messages.context_messages.sort((a: Message, b: Message) => 
        new Date(a.message_timestamp).getTime() - new Date(b.message_timestamp).getTime());
    
      // Map each message to a formatted string "[HH:MM] Username: Content"
      const logLines = messages.context_messages.map((msg: Message) => {
        // You can use the "created_at" field if available since it's already in "YYYY-MM-DD HH:MM:SS" format.
        // Here, we extract the HH:MM portion. If not available, we fallback to parsing message_timestamp.
        const timeString = msg.created_at ? msg.created_at.slice(11, 16) :
          new Date(msg.message_timestamp).toISOString().substr(11, 5);
        
        // Use globalName if available; otherwise, use username.
        const username = msg.globalName || msg.username;
        const userId = msg.author_id;
        
        return `[${timeString}] ${username}: ${msg.content}`;
      });
    
      // Join all lines with newline characters to create the final chat log string.
      return logLines;
    } catch(ex) {
      console.log(ex);
      return [];
    }
   
}

async function getMessageContext(messageId: string): Promise<MessageContext> {
  console.log(`Looking for message ID: ${messageId}`);
  return new Promise((resolve, reject) => {
    // First, get the message itself along with its channel ID
    const msgSql = `
    SELECT m.*, a.username, a.avatar, a.globalName
    FROM messages m
    LEFT JOIN authors a ON m.author_id = a.id
    WHERE m.id = ?
    `;
    console.log(`Executing SQL: ${msgSql.trim()} with params: [${messageId}]`);
    
    db.get(msgSql, [messageId], (err, message: Message) => {
      // Handle database errors first
      if (err) {
        console.error("Database error:", err);
        return reject(new Error(`Database error: ${err.message}`));
      }
      
      // Check if message exists
      if (!message) {
        console.error(`Message not found with ID: ${messageId}`);
        return reject(new Error('Message not found'));
      }
      
      const channelId = message.channelId;
      const messageTimestamp = message.message_timestamp;
      
      console.log(`Found message in channel: ${channelId}, timestamp: ${messageTimestamp}`);
      
      // Then, get 20 messages from the same channel
      const contextSql = `
        SELECT m.*, a.username, a.avatar, a.globalName
        FROM messages m
        LEFT JOIN authors a ON m.author_id = a.id
        WHERE m.channelId = ?
          AND m.id != ?  -- Exclude the requested message itself since we already have it
        ORDER BY m.message_timestamp
        LIMIT 20
      `;
      
      db.all(contextSql, [channelId, messageId], (err, contextMessages: Message[]) => {
        if (err) {
          console.error("Error fetching context messages:", err);
          return reject(new Error(`Error fetching context messages: ${err.message}`));
        }
        
        console.log(`Retrieved ${contextMessages.length} context messages for message ${messageId}`);
        
        const resultData: MessageContext = {
          message: message,
          channel_id: channelId,
          context_messages: contextMessages,
          context_message_count: contextMessages.length
        };
        
        return resolve(resultData);
      });
    });
  });
}

// Create normalized tables (modified messages table includes author_id)
db.serialize(() => {
  // Main messages table
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,                   
      event_type TEXT,                       
      guildId TEXT,                          
      channelId TEXT,                        
      message_guild_id TEXT,                 
      author_id TEXT,                        -- NEW: to reference authors table
      content TEXT,                          
      edited_timestamp TEXT,                 
      flags INTEGER,                         
      nonce TEXT,                            
      pinned INTEGER,                        
      message_timestamp TEXT,                
      tts INTEGER,                           
      message_type INTEGER,                  
      optimistic INTEGER,                    
      isPushNotification INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating messages table:', err.message);
    else console.log('Messages table is ready.');
  });

  // Authors table
  db.run(`
    CREATE TABLE IF NOT EXISTS authors (
      id TEXT PRIMARY KEY,
      avatar TEXT,
      clan TEXT,
      discriminator TEXT,
      primary_guild TEXT,
      username TEXT,
      publicFlags INTEGER,
      avatarDecorationData TEXT,
      globalName TEXT
    )
  `, (err) => {
    if (err) console.error('Error creating authors table:', err.message);
    else console.log('Authors table is ready.');
  });

  // Attachments table
  db.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      attachment_id TEXT,
      filename TEXT,
      size INTEGER,
      url TEXT,
      proxy_url TEXT,
      height INTEGER,
      width INTEGER,
      FOREIGN KEY(message_id) REFERENCES messages(id)
    )
  `, (err) => { if (err) console.error('Error creating attachments table:', err.message); });

  // Embeds table
  db.run(`
    CREATE TABLE IF NOT EXISTS embeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      title TEXT,
      embed_type TEXT,
      description TEXT,
      url TEXT,
      timestamp TEXT,
      color INTEGER,
      footer TEXT,         -- stored as JSON string if not further normalized
      image TEXT,          
      thumbnail TEXT,      
      video TEXT,          
      provider TEXT,       
      fields TEXT,         
      FOREIGN KEY(message_id) REFERENCES messages(id)
    )
  `, (err) => { if (err) console.error('Error creating embeds table:', err.message); });

  // Components table
  db.run(`
    CREATE TABLE IF NOT EXISTS components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      comp_type INTEGER,
      label TEXT,
      style INTEGER,
      custom_id TEXT,
      url TEXT,
      disabled INTEGER,
      emoji TEXT,
      FOREIGN KEY(message_id) REFERENCES messages(id)
    )
  `, (err) => { if (err) console.error('Error creating components table:', err.message); });

  // Members table
  db.run(`
    CREATE TABLE IF NOT EXISTS members (
      message_id TEXT PRIMARY KEY,
      avatar TEXT,
      banner TEXT,
      communication_disabled_until TEXT,
      deaf INTEGER,
      flags INTEGER,
      joined_at TEXT,
      mute INTEGER,
      nick TEXT,
      pending INTEGER,
      premium_since TEXT,
      roles TEXT,
      FOREIGN KEY(message_id) REFERENCES messages(id)
    )
  `, (err) => { if (err) console.error('Error creating members table:', err.message); });

  // Mentions table
  db.run(`
    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      user_id TEXT,
      username TEXT,
      discriminator TEXT,
      avatar TEXT,
      globalName TEXT,
      FOREIGN KEY(message_id) REFERENCES messages(id)
    )
  `, (err) => { if (err) console.error('Error creating mentions table:', err.message); });

  // Message References table
  db.run(`
    CREATE TABLE IF NOT EXISTS message_references (
      message_id TEXT PRIMARY KEY,
      ref_channel_id TEXT,
      ref_guild_id TEXT,
      ref_message_id TEXT,
      ref_type INTEGER,
      FOREIGN KEY(message_id) REFERENCES messages(id)
    )
  `, (err) => { if (err) console.error('Error creating message_references table:', err.message); });

  // Referenced Messages table
  db.run(`
    CREATE TABLE IF NOT EXISTS referenced_messages (
      id TEXT PRIMARY KEY,
      parent_message_id TEXT,
      channel_id TEXT,
      content TEXT,
      edited_timestamp TEXT,
      flags INTEGER,
      mention_everyone INTEGER,
      pinned INTEGER,
      timestamp TEXT,
      tts INTEGER,
      ref_message_type INTEGER,
      FOREIGN KEY(parent_message_id) REFERENCES messages(id)
    )
  `, (err) => { if (err) console.error('Error creating referenced_messages table:', err.message); });

  // User Insights table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      insight_name TEXT,
      insight_value TEXT,
      FOREIGN KEY(user_id) REFERENCES authors(id)
    )
  `, (err) => { 
    if (err) console.error('Error creating user_insights table:', err.message);
    else console.log('User insights table is ready.');
  });
});

// -------------------
// Data Insertion Endpoint (existing POST /messages)
// -------------------

app.post('/messages', (req, res) => {
  const { type, guildId, channelId, message, optimistic, isPushNotification } = req.body;
  
  if (!message || !message.id) {
    return res.status(400).json({ success: false, error: 'Message object must contain an id' });
  }
  
  // Insert/update author record
  if (message.author && message.author.id) {
    const authorSql = `
      INSERT OR REPLACE INTO authors (
        id, avatar, clan, discriminator, primary_guild, username, publicFlags, avatarDecorationData, globalName
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const authorValues = [
      message.author.id,
      message.author.avatar,
      message.author.clan,
      message.author.discriminator,
      message.author.primary_guild,
      message.author.username,
      message.author.publicFlags,
      message.author.avatarDecorationData,
      message.author.globalName
    ];
    db.run(authorSql, authorValues, function(err) {
      if (err) console.error('Failed to insert/update author:', err.message);
      else console.log('Author record updated:', message.author.id);
    });
  }
  
  // Insert main message record (including author_id)
  const msgSql = `
    INSERT OR REPLACE INTO messages (
      id, event_type, guildId, channelId, message_guild_id, author_id, content, edited_timestamp, flags, nonce, pinned,
      message_timestamp, tts, message_type, optimistic, isPushNotification
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const msgValues = [
    message.id,
    type,
    guildId,
    channelId,
    message.guild_id,
    message.author && message.author.id ? message.author.id : null,
    message.content,
    message.edited_timestamp,
    message.flags,
    message.nonce,
    message.pinned ? 1 : 0,
    message.timestamp,
    message.tts ? 1 : 0,
    message.type,
    optimistic ? 1 : 0,
    isPushNotification ? 1 : 0
  ];
  
  db.run(msgSql, msgValues, function(err) {
    if (err) {
      console.error('Failed to insert message:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
    console.log('Message record inserted:', message.id);

    // Insert attachments
    if (Array.isArray(message.attachments)) {
      message.attachments.forEach((att: any) => {
        const attSql = `
          INSERT INTO attachments (message_id, attachment_id, filename, size, url, proxy_url, height, width)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(attSql, [
          message.id,
          att.id || null,
          att.filename || null,
          att.size || null,
          att.url || null,
          att.proxy_url || null,
          att.height || null,
          att.width || null
        ], function(err) {
          if (err) console.error('Failed to insert attachment:', err.message);
        });
      });
    }
    
    // Insert embeds
    if (Array.isArray(message.embeds)) {
      message.embeds.forEach((embed: any) => {
        const embedSql = `
          INSERT INTO embeds (
            message_id, title, embed_type, description, url, timestamp, color,
            footer, image, thumbnail, video, provider, fields
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(embedSql, [
          message.id,
          embed.title || null,
          embed.type || null,
          embed.description || null,
          embed.url || null,
          embed.timestamp || null,
          embed.color || null,
          embed.footer ? JSON.stringify(embed.footer) : null,
          embed.image ? JSON.stringify(embed.image) : null,
          embed.thumbnail ? JSON.stringify(embed.thumbnail) : null,
          embed.video ? JSON.stringify(embed.video) : null,
          embed.provider ? JSON.stringify(embed.provider) : null,
          embed.fields ? JSON.stringify(embed.fields) : null
        ], function(err) {
          if (err) console.error('Failed to insert embed:', err.message);
        });
      });
    }
    
    // Insert components
    if (Array.isArray(message.components)) {
      message.components.forEach((comp: any) => {
        const compSql = `
          INSERT INTO components (
            message_id, comp_type, label, style, custom_id, url, disabled, emoji
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(compSql, [
          message.id,
          comp.type || null,
          comp.label || null,
          comp.style || null,
          comp.custom_id || null,
          comp.url || null,
          comp.disabled ? 1 : 0,
          comp.emoji ? JSON.stringify(comp.emoji) : null
        ], function(err) {
          if (err) console.error('Failed to insert component:', err.message);
        });
      });
    }
    
    // Insert member data
    if (message.member) {
      const mem = message.member;
      const memberSql = `
        INSERT OR REPLACE INTO members (
          message_id, avatar, banner, communication_disabled_until, deaf, flags, joined_at,
          mute, nick, pending, premium_since, roles
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(memberSql, [
        message.id,
        mem.avatar || null,
        mem.banner || null,
        mem.communication_disabled_until || null,
        mem.deaf ? 1 : 0,
        mem.flags || null,
        mem.joined_at || null,
        mem.mute ? 1 : 0,
        mem.nick || null,
        mem.pending ? 1 : 0,
        mem.premium_since || null,
        mem.roles ? JSON.stringify(mem.roles) : null
      ], function(err) {
        if (err) console.error('Failed to insert member:', err.message);
      });
    }
    
    // Insert mentions
    if (Array.isArray(message.mentions)) {
      message.mentions.forEach((mention: any) => {
        const mentionSql = `
          INSERT INTO mentions (
            message_id, user_id, username, discriminator, avatar, globalName
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        db.run(mentionSql, [
          message.id,
          mention.id || null,
          mention.username || null,
          mention.discriminator || null,
          mention.avatar || null,
          mention.globalName || null
        ], function(err) {
          if (err) console.error('Failed to insert mention:', err.message);
        });
      });
    }
    
    // Insert message reference
    if (message.message_reference) {
      const ref = message.message_reference;
      const refSql = `
        INSERT OR REPLACE INTO message_references (
          message_id, ref_channel_id, ref_guild_id, ref_message_id, ref_type
        )
        VALUES (?, ?, ?, ?, ?)
      `;
      db.run(refSql, [
        message.id,
        ref.channel_id || null,
        ref.guild_id || null,
        ref.message_id || null,
        ref.type || null
      ], function(err) {
        if (err) console.error('Failed to insert message reference:', err.message);
      });
    }
    
    // Insert referenced message
    if (message.referenced_message) {
      const refMsg = message.referenced_message;
      const refMsgSql = `
        INSERT OR REPLACE INTO referenced_messages (
          id, parent_message_id, channel_id, content, edited_timestamp, flags,
          mention_everyone, pinned, timestamp, tts, ref_message_type
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(refMsgSql, [
        refMsg.id || null,
        message.id,
        refMsg.channel_id || null,
        refMsg.content || null,
        refMsg.edited_timestamp || null,
        refMsg.flags || null,
        refMsg.mention_everyone ? 1 : 0,
        refMsg.pinned ? 1 : 0,
        refMsg.timestamp || null,
        refMsg.tts ? 1 : 0,
        refMsg.type || null
      ], function(err) {
        if (err) console.error('Failed to insert referenced message:', err.message);
      });
    }
    
    res.json({ success: true });
  });
});

// -------------------
// New GET Endpoints
// -------------------

// 1. GET /messages - Retrieve all messages with author details
app.get('/messages', (req, res) => {
  const sql = `
    SELECT m.*, a.username, a.avatar, a.globalName
    FROM messages m
    LEFT JOIN authors a ON m.author_id = a.id
    ORDER BY m.created_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ messages: rows });
  });
});

// 2. GET /messages/:id - Retrieve a single message with full details
app.get('/messages/:id', (req, res) => {
  const messageId = req.params.id;
  // Query main message joined with author details
  const msgSql = `
    SELECT m.*, a.username, a.avatar, a.globalName
    FROM messages m
    LEFT JOIN authors a ON m.author_id = a.id
    WHERE m.id = ?
  `;
  db.get(msgSql, [messageId], (err, message) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    // Query related entities in parallel
    const queries = {
      attachments: { sql: "SELECT * FROM attachments WHERE message_id = ?", params: [messageId] },
      embeds: { sql: "SELECT * FROM embeds WHERE message_id = ?", params: [messageId] },
      components: { sql: "SELECT * FROM components WHERE message_id = ?", params: [messageId] },
      member: { sql: "SELECT * FROM members WHERE message_id = ?", params: [messageId] },
      mentions: { sql: "SELECT * FROM mentions WHERE message_id = ?", params: [messageId] },
      message_reference: { sql: "SELECT * FROM message_references WHERE message_id = ?", params: [messageId] },
      referenced_message: { sql: "SELECT * FROM referenced_messages WHERE parent_message_id = ?", params: [messageId] }
    };

    const results: ResultsMap = {};
    let pending = Object.keys(queries).length;
    Object.entries(queries).forEach(([key, { sql, params }]) => {
      db.all(sql, params, (err, rows) => {
        if (err) results[key] = { error: err.message };
        else results[key] = rows;
        pending--;
        if (pending === 0) {
          // Return a combined object
          res.json({ message, ...results });
        }
      });
    });
  });
});

app.get('/messages/log/:messageId', async (req, res) => {
    const log = await getChatLog(req.params.messageId)
    res.json({
        messages: log
    });
});

// 3. GET /messages/user/:userId - Retrieve messages by a specific author
app.get('/messages/user/:userId', (req, res) => {
  const userId = req.params.userId;
  const sql = `
    SELECT m.*, a.username, a.avatar, a.globalName
    FROM messages m
    LEFT JOIN authors a ON m.author_id = a.id
    WHERE m.author_id = ?
    ORDER BY m.created_at DESC
  `;
  db.all(sql, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ messages: rows });
  });
});

// 4. GET /authors - Retrieve all authors
app.get('/authors', (req, res) => {
  const sql = `SELECT * FROM authors ORDER BY username`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ authors: rows });
  });
});

// 5. GET /authors/:id - Retrieve a specific author
app.get('/authors/:id', (req, res) => {
  const authorId = req.params.id;
  const sql = `SELECT * FROM authors WHERE id = ?`;
  db.get(sql, [authorId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Author not found' });
    res.json({ author: row });
  });
});

// 6. GET /messages/:id/attachments - Retrieve attachments for a message
app.get('/messages/:id/attachments', (req, res) => {
  const messageId = req.params.id;
  const sql = `SELECT * FROM attachments WHERE message_id = ?`;
  db.all(sql, [messageId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ attachments: rows });
  });
});

// 7. GET /messages/:id/embeds - Retrieve embeds for a message
app.get('/messages/:id/embeds', (req, res) => {
  const messageId = req.params.id;
  const sql = `SELECT * FROM embeds WHERE message_id = ?`;
  db.all(sql, [messageId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ embeds: rows });
  });
});

// 8. GET /messages/:id/components - Retrieve components for a message
app.get('/messages/:id/components', (req, res) => {
  const messageId = req.params.id;
  const sql = `SELECT * FROM components WHERE message_id = ?`;
  db.all(sql, [messageId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ components: rows });
  });
});

// 9. GET /messages/:id/member - Retrieve member details for a message
app.get('/messages/:id/member', (req, res) => {
  const messageId = req.params.id;
  const sql = `SELECT * FROM members WHERE message_id = ?`;
  db.get(sql, [messageId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ member: row });
  });
});

// 10. GET /messages/:id/mentions - Retrieve mentions for a message
app.get('/messages/:id/mentions', (req, res) => {
  const messageId = req.params.id;
  const sql = `SELECT * FROM mentions WHERE message_id = ?`;
  db.all(sql, [messageId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ mentions: rows });
  });
});

// 11. GET /messages/:id/message-reference - Retrieve message reference for a message
app.get('/messages/:id/message-reference', (req, res) => {
  const messageId = req.params.id;
  const sql = `SELECT * FROM message_references WHERE message_id = ?`;
  db.get(sql, [messageId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message_reference: row });
  });
});

// 12. GET /messages/:id/referenced-message - Retrieve referenced message for a message
app.get('/messages/:id/referenced-message', (req, res) => {
  const messageId = req.params.id;
  const sql = `SELECT * FROM referenced_messages WHERE parent_message_id = ?`;
  db.get(sql, [messageId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ referenced_message: row });
  });
});

// Add this new endpoint after your other endpoints

// GET /message-context/:messageId - Retrieve a message with surrounding context from the same channel
app.get('/message-context/:messageId', async (req, res) => {
    const messageId = req.params.messageId;
    try {
        const messages = await getMessageContext(messageId);
        res.json(messages);        
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/messages/classifier', async (req, res) => {
  /* Send a POST to http://127.0.0.1:8000/predict with the message content in the following format
  {
    "text": ""
  }
  */

  const messages = req.body;

  /*
  The schema for the response should be:
  [
    {
        "label": "",
        "score": 0.9356187582015991
    }
  ]

  Possible labels are:
  ["HUMAN_WRITTEN","MACHINE_GENERATED","HUMAN_WRITTEN_MACHINE_POLISHED","MACHINE_WRITTEN_MACHINE_HUMANIZED"]
  */

  console.log(messages);

  // Split them all up into a singke string
  const splitMessages = messages.text.join("\n");

  const response = await axios.post("http://127.0.0.1:8000/predict", {
    text: splitMessages
  });

  return res.json(response.data);

});

app.post('/messages/tone', async (req, res) => {

  try {

    // Get from the message POST request
    const message = req.body;
    const chatLog = await getChatLog(message.message.id);

    const schema = {
      "type": "object",
      "properties": {
        "tone": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "None",
              "Joking",
              "Sarcastic",
              "Half-joking",
              "Genuine (sincere)",
              "Serious",
              "Positive connotation",
              "Negative connotation",
              "Neutral tone",
              "Lighthearted",
              "Genuine",
              "Silly",
              "Reference"
            ]
          },
          "minItems": 0,
          "maxItems": 1,
          "uniqueItems": true,
          "description": `A list of tone(s) that describe the emotional or contextual tone of the input text.`
        }
      },
      "required": ["tone"]
    };
    

    const queryMessage = {
        role: 'user',
        content: `

            Here is the context for the chat log for the conversation. Please return the tone for the last message in the chat log.
            ${JSON.stringify(chatLog)}
        `
    }

    const response = await ollama.chat(
        {
            model: 'llama3.1',
            messages: [queryMessage],
            format: schema,
            stream: false,
        }
    )


    res.json({
        tone: JSON.parse(response.message.content).tone
    });

  } catch(ex) {
    console.log(ex);

    res.json({
      tone: ""
    });
  }
    
    
});

app.post('/user_insights/generate/:user_id', (req, res) => {
    // Fetch all messages by the user
    const userId = req.params.user_id;
    const sql = `SELECT * FROM messages WHERE author_id = ?`;
    
    db.all(sql, [userId], async (err, userMessages: Message[]) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (userMessages.length === 0) {
        return res.json({
          user_id: userId,
          message_count: 0,
          message: "No messages found for this user"
        });
      }
      
      try {
        // For each user message, fetch related messages from the same channel within 5 minutes
        const messageWithContext: any = [];
        
        for (const msg of userMessages) {
          const timestamp = new Date(msg.message_timestamp);
          
          // Calculate 5 minutes before and after the message timestamp
          const fiveMinBefore = new Date(timestamp.getTime() - 5 * 60 * 1000).toISOString();
          const fiveMinAfter = new Date(timestamp.getTime() + 5 * 60 * 1000).toISOString();
          
          // Fetch related messages that share the same channel and are within the time window
          const relatedMsgSql = `
            SELECT m.*, a.username, a.globalName 
            FROM messages m
            LEFT JOIN authors a ON m.author_id = a.id
            WHERE m.channelId = ? 
              AND m.message_timestamp BETWEEN ? AND ?
              AND m.id != ?
            ORDER BY m.message_timestamp
          `;
          
          const relatedMessages = await new Promise<Message[]>((resolve, reject) => {
            db.all(relatedMsgSql, [msg.channelId, fiveMinBefore, fiveMinAfter, msg.id], (err, rows: Message[]) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });
          
          messageWithContext.push({
            message: msg,
            related_messages: relatedMessages
          });
        }
        
        // Generate insights here (placeholder for now)
        // For now, just return some basic stats
        const insights = [
          {
            insight_name: "message_count",
            insight_value: userMessages.length.toString()
          },
          {
            insight_name: "channels_posted_in",
            insight_value: [...new Set(userMessages.map((m: Message) => m.channelId))].length.toString()
          }
        ];
        
        res.json({
          user_id: userId,
          message_count: userMessages.length,
          insights: insights,
          // Only send back the first few messages with context to avoid huge response
          messages: messageWithContext.slice(0, 20)
        });
        
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
});

// GET /user_insights/:user_id - Retrieve all insights for a specific user
app.get('/user_insights/generate/:user_id', (req, res) => {
  const userId = req.params.user_id;
  
  const sql = `
    SELECT * FROM user_insights 
    WHERE user_id = ?
    ORDER BY insight_name
  `;
  
  db.all(sql, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    
    if (rows.length === 0) {
      return res.json({ 
        user_id: userId,
        insights: [],
        message: "No insights found for this user" 
      });
    }
    
    res.json({ 
      user_id: userId,
      insights: rows
    });
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
