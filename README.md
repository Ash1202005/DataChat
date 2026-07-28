# DataChat — AI-Powered Natural Language SQL Chatbot

A privacy-first AI chatbot that lets users query a **Microsoft SQL Server** database using plain English — no SQL knowledge needed.

Built with **Node.js**, **Google Gemini AI**, and a vanilla HTML/CSS/JS frontend.

---

## How It Works

The system uses a three-step privacy pipeline:

```
User Question
      │
      ▼
[Step 1] Gemini AI receives: question + DB schema (table/column names only)
         → Returns a T-SQL SELECT query
      │
      ▼
[Step 2] Backend executes SQL on YOUR local SQL Server
         → AI never touches the database directly
      │
      ▼
[Step 3] Gemini AI receives: question + query result rows (max 50)
         → Returns a plain-English answer
```

The AI only ever sees your database *structure* (table names, column names) — never your actual data rows, until the specific result of one query is returned for formatting.

---

## Features

- **Natural language to T-SQL** — ask questions in plain English
- **Conversation memory** — follow-up questions work naturally ("what about Product B?")
- **SQL safety validator** — blocks INSERT, UPDATE, DELETE, DROP, etc. at the code level
- **Read-only DB login** — additional database-level protection
- **Generated SQL visible** — full transparency; users can see the query that was run
- **Schema caching** — DB structure fetched once, cached for performance

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI | Google Gemini 2.5 Flash (free tier) |
| Backend | Node.js + Express |
| Database | Microsoft SQL Server (local) |
| Frontend | Vanilla HTML / CSS / JS |
| AI SDK | @google/genai |
| DB Driver | mssql (npm) |

---

## Project Structure

```
datachat/
├── backend/
│   ├── server.js          ← Main backend: all logic, routes, AI calls
│   ├── package.json       ← Node.js dependencies
│   └── .env.example       ← Template for environment variables (copy → .env)
│
└── frontend/
    └── index.html         ← Web chat UI (open directly in browser)
```

---

## Setup & Running Locally

### Prerequisites
- Node.js 18+ installed
- Microsoft SQL Server running locally
- AdventureWorks2025 (or your own) database restored
- Free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### 1. Create a read-only SQL login (run in SSMS)

```sql
CREATE LOGIN datachat_user WITH PASSWORD = 'YourStrongPassword123!';
USE AdventureWorks2025;
CREATE USER datachat_user FOR LOGIN datachat_user;
EXEC sp_addrolemember 'db_datareader', 'datachat_user';
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
# Open .env and fill in your Gemini API key and DB credentials
```

### 4. Start the backend

```bash
npm run dev
```

You should see:
```
🚀 DataChat Backend running → http://localhost:3001
✅ Connected to AdventureWorks2025
📋 Schema cached: 71 tables
```

### 5. Open the frontend

Open `frontend/index.html` in your browser. That's it — no build step needed.

---

## API Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Check if backend + DB are running |
| POST | `/api/chat` | Send a message, receive AI answer + SQL |
| GET | `/api/schema` | List all cached table names |
| POST | `/api/schema/refresh` | Re-fetch schema from DB |
| DELETE | `/api/conversation/:id` | Clear a session's history |

### Example request to `/api/chat`

```json
POST http://localhost:3001/api/chat
{
  "message": "What are the top 5 best-selling products?",
  "conversationId": "conv_abc123"
}
```

### Example response

```json
{
  "success": true,
  "response": "The top 5 best-selling products are:\n1. AWC Logo Cap — 8,311 units\n...",
  "metadata": {
    "sql": "SELECT TOP 5 p.Name, SUM(sod.OrderQty) AS TotalSold FROM ...",
    "rowsReturned": 5,
    "durationMs": 1240
  }
}
```

---

## Security Design

- AI generates SQL but **never executes it** — the backend does
- All AI-generated SQL is validated before execution (keyword blacklist)
- Only `SELECT` and `WITH` (CTE) queries are permitted
- Separate read-only database login (`db_datareader` role only)
- Schema (structure) and result rows sent separately to AI — not the full database
- `.env` is gitignored — credentials never committed to the repository

---

## Adapting to a Different Database

To use this with your own database instead of AdventureWorks:

1. Update `DB_NAME` in `.env`
2. The schema is auto-fetched — no code changes needed
3. Call `POST /api/schema/refresh` after any schema changes

---

## Known Limitations

- Read-only by design — cannot INSERT, UPDATE, or DELETE data
- AI may occasionally generate incorrect SQL for very complex queries (user can rephrase)
- Free Gemini tier: 250–1,000 requests/day depending on model
- Conversation history stored in-memory — lost on server restart (use Redis for production)

---

## License

MIT
