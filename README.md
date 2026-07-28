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


## Known Limitations

- Read-only by design — cannot INSERT, UPDATE, or DELETE data
- AI may occasionally generate incorrect SQL for very complex queries (user can rephrase)
- Free Gemini tier: 250–1,000 requests/day depending on model
- Conversation history stored in-memory — lost on server restart

