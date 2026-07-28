// ============================================================
// DataChat Backend — Google GenAI SDK (new) + MSSQL
// SDK: @google/genai (replaces deprecated @google/generative-ai)
// Model: gemini-2.0-flash (free tier, works with AI Studio keys)
// ============================================================
require('dotenv').config();
const express = require("express");
const cors    = require("cors");
const sql     = require("mssql");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(cors());
app.use(express.json());

const PORT           = process.env.PORT || 3001;
const HISTORY_WINDOW = 10;

// ── Gemini Client (new SDK) ───────────────────────────────────
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE",
});

// ── MSSQL Config ──────────────────────────────────────────────
const dbConfig = process.env.USE_WINDOWS_AUTH === "true"
  ? {
      server:   process.env.DB_HOST || "localhost",
      database: process.env.DB_NAME || "AdventureWorks2025",
      port:     parseInt(process.env.DB_PORT) || 1433,
      options:  { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    }
  : {
      server:   process.env.DB_HOST || "localhost",
      database: process.env.DB_NAME || "AdventureWorks2025",
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port:     parseInt(process.env.DB_PORT) || 1433,
      options:  { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    };

let dbPool = null;
async function getDB() {
  if (!dbPool) {
    dbPool = await sql.connect(dbConfig);
    console.log("✅ Connected to AdventureWorks2025");
  }
  return dbPool;
}

// ── Schema Cache ──────────────────────────────────────────────
let schemaCache = null;

async function fetchDatabaseSchema() {
  if (schemaCache) return schemaCache;
  const pool = await getDB();
  const result = await pool.request().query(`
    SELECT
      s.name  AS schema_name,
      t.name  AS table_name,
      c.name  AS column_name,
      tp.name AS data_type,
      CASE WHEN pk.column_id IS NOT NULL THEN 'PK' ELSE '' END AS key_type
    FROM sys.tables t
    JOIN sys.schemas s   ON t.schema_id    = s.schema_id
    JOIN sys.columns c   ON t.object_id    = c.object_id
    JOIN sys.types   tp  ON c.user_type_id = tp.user_type_id
    LEFT JOIN (
        SELECT ic.object_id, ic.column_id
        FROM sys.index_columns ic
        JOIN sys.indexes i ON ic.object_id = i.object_id
                          AND ic.index_id  = i.index_id
        WHERE i.is_primary_key = 1
    ) pk ON t.object_id = pk.object_id AND c.column_id = pk.column_id
    ORDER BY s.name, t.name, c.column_id
  `);

  const schema = {};
  for (const row of result.recordset) {
    const key = `${row.schema_name}.${row.table_name}`;
    if (!schema[key]) schema[key] = [];
    schema[key].push({
      column: row.column_name,
      type:   row.data_type,
      key:    row.key_type || null,
    });
  }

  schemaCache = schema;
  console.log(`📋 Schema cached: ${Object.keys(schema).length} tables`);
  return schema;
}

// Compact format: Schema.Table(col type*,col type,...)
// Produces ~5,000 chars for AdventureWorks — well within limits
function formatSchemaForPrompt(schema) {
  return Object.entries(schema)
    .map(([table, cols]) => {
      const colStr = cols
        .map(c => `${c.column} ${c.type}${c.key === "PK" ? "*" : ""}`)
        .join(",");
      return `${table}(${colStr})`;
    })
    .join("\n");
}

// ── SQL Safety Guard ──────────────────────────────────────────
function validateSQL(sqlStr) {
  const norm = sqlStr.trim().toUpperCase().replace(/\s+/g, " ");
  const forbidden = [
    "INSERT ","UPDATE ","DELETE ","DROP ","ALTER ",
    "CREATE ","TRUNCATE ","EXEC ","EXECUTE ","MERGE ",
    "BULK INSERT","OPENROWSET","OPENDATASOURCE","XP_CMDSHELL",
  ];
  for (const kw of forbidden) {
    if (norm.includes(kw))
      throw new Error(`Unsafe SQL blocked: ${kw.trim()}. Only SELECT is permitted.`);
  }
  if (!norm.trim().startsWith("SELECT") && !norm.trim().startsWith("WITH"))
    throw new Error("Only SELECT and WITH (CTE) queries are allowed.");
}

// ── Session Store ─────────────────────────────────────────────
const sessions = new Map();
function getHistory(id)       { return sessions.get(id) || []; }
function saveHistory(id, arr) { sessions.set(id, arr.slice(-(HISTORY_WINDOW * 2))); }
function appendTurn(id, role, content) {
  const h = getHistory(id);
  h.push({ role, content });
  saveHistory(id, h);
}

// ── New SDK: chat history format ──────────────────────────────
// New @google/genai uses { role: "user"|"model", parts: [{text}] }
function buildHistory(history) {
  return history.map(m => ({
    role:  m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

// ── Step 1: Generate T-SQL ────────────────────────────────────
async function generateSQL(userQuery, schema, history) {
  const schemaText = formatSchemaForPrompt(schema);

  // Schema goes into history as a priming pair — NOT in system instruction
  // (system instruction has a size limit; message history does not)
  const historyWithSchema = [
    {
      role:  "user",
      parts: [{ text: `AdventureWorks2025 schema (* = primary key):\n${schemaText}` }],
    },
    {
      role:  "model",
      parts: [{ text: "Schema loaded. Ready to generate T-SQL." }],
    },
    ...buildHistory(history),
  ];

  const chat = ai.chats.create({
    model: "gemini-2.5-flash",
    config: {
      systemInstruction: `You are a Microsoft SQL Server T-SQL query generator.
Output ONLY the raw SQL. No markdown, no backticks, no explanation.
Only SELECT or WITH (CTE). Never INSERT/UPDATE/DELETE/DROP/ALTER/EXEC/MERGE.
T-SQL syntax only: use TOP n, GETDATE(), schema-qualified names (e.g. Sales.SalesOrderHeader).
Resolve context from conversation history ("that product", "same period", "also for X").
If unanswerable from the schema, output exactly: CANNOT_ANSWER
Default to SELECT TOP 20 unless the user specifies a number.`,
    },
    history: historyWithSchema,
  });

  const result = await chat.sendMessage({ message: userQuery });
  let generatedSQL = result.text.trim();

  // Strip any accidental markdown fences
  generatedSQL = generatedSQL
    .replace(/^```sql\s*/i, "")
    .replace(/^```\s*/i,    "")
    .replace(/\s*```$/,     "")
    .trim();

  if (generatedSQL.toUpperCase() === "CANNOT_ANSWER")
    throw new Error("This question cannot be answered with the available AdventureWorks schema.");

  return generatedSQL;
}

// ── Step 2: Execute SQL ───────────────────────────────────────
async function executeSQL(sqlStr) {
  validateSQL(sqlStr);
  const pool   = await getDB();
  const result = await pool.request().query(sqlStr);
  return result.recordset;
}

// ── Step 3: Format response ───────────────────────────────────
async function formatResponse(userQuery, results, history) {
  const dataText = results.length === 0
    ? "No records found."
    : JSON.stringify(results.slice(0, 50), null, 2);

  const chat = ai.chats.create({
    model: "gemini-2.5-flash",
    config: {
      systemInstruction: `You are a friendly business assistant explaining data in plain English.
Be concise. Answer the question directly first.
Format numbers with commas (1,234). Currency as $1,234.56.
Use bullet points or plain-text tables when helpful.
Never mention SQL, databases, table names, or technical details.
Use conversation history for context-aware answers.`,
    },
    history: buildHistory(history),
  });

  const prompt = `The user asked: "${userQuery}"
Database returned ${results.length} record(s):
${dataText}
Provide a clear, helpful answer based on this data.`;

  const result = await chat.sendMessage({ message: prompt });
  return result.text.trim();
}

// ── Routes ────────────────────────────────────────────────────
app.get("/health", async (_, res) => {
  try {
    await getDB();
    res.json({ status: "ok", db: "connected", model: "gemini-2.0-flash" });
  } catch (e) {
    res.status(500).json({ status: "error", db: e.message });
  }
});

app.post("/api/schema/refresh", async (_, res) => {
  schemaCache = null;
  const schema = await fetchDatabaseSchema();
  res.json({ success: true, tableCount: Object.keys(schema).length, tables: Object.keys(schema) });
});

app.get("/api/schema", async (_, res) => {
  const schema = await fetchDatabaseSchema();
  res.json({ tables: Object.keys(schema), count: Object.keys(schema).length });
});

app.post("/api/chat", async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message?.trim())        return res.status(400).json({ error: "message is required." });
  if (!conversationId?.trim()) return res.status(400).json({ error: "conversationId is required." });

  const start = Date.now();
  let generatedSQL = null;

  try {
    const schema  = await fetchDatabaseSchema();
    const history = getHistory(conversationId);

    generatedSQL        = await generateSQL(message, schema, history);
    const results       = await executeSQL(generatedSQL);
    const humanResponse = await formatResponse(message, results, history);

    appendTurn(conversationId, "user",      message);
    appendTurn(conversationId, "assistant", humanResponse);

    console.log(`[${new Date().toISOString()}] rows=${results.length} ms=${Date.now()-start}`);
    console.log(`SQL: ${generatedSQL}`);

    res.json({
      success:  true,
      response: humanResponse,
      metadata: {
        sql:           generatedSQL,
        rowsReturned:  results.length,
        durationMs:    Date.now() - start,
        historyLength: getHistory(conversationId).length,
      },
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({
      success: false,
      error:   err.message,
      metadata: { sql: generatedSQL, durationMs: Date.now() - start },
    });
  }
});

app.delete("/api/conversation/:id", (req, res) => {
  sessions.delete(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n🚀 DataChat Backend → http://localhost:${PORT}`);
  console.log(`🤖 AI: Google Gemini 2.0 Flash (@google/genai new SDK)`);
  console.log(`🗄️  DB: AdventureWorks2025 (local MSSQL)\n`);
});
