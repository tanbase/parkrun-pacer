# parkrun-pacer Context

## Project Overview
Parkrun Pacer is a performance analysis tool for parkrun events. It provides course information, elevation profiles, age grade calculations and pacing predictions.

## Repository Structure
```
parkrun-pacer/
├── scripts/
│   ├── enrich-courses.js     ✅ Course enrichment with LLM descriptions + elevation
│   ├── parkrun-crawler.js    🕷️  Event results crawler
│   ├── import-rawdata.js     📥 Raw HTML data processor
│   ├── analyse-results.js    📊 Result analysis and statistics
│   ├── populate-gps-data.cjs 🗺️  GPS data population
│   └── fix-filenames.js      🔧 File normalisation utility
├── src/
│   ├── App.tsx               Frontend React application
│   ├── hooks/
│   ├── utils/
│   └── data/
│       ├── courses.json      Main course database
│       └── rawdata/          Raw HTML event pages
└── public/
```

---

## Scripts Reference

### 🟢 enrich-courses.js
**Primary maintenance script**

Parses raw course pages, extracts:
- LLM generated course descriptions using Gemini 2.5 Flash
- Terrain classification
- KML course path extraction
- Elevation profile calculation from OpenTopoData

**CURRENT RATE LIMITS (April 2026):**
✅ **Gemini 2.5 Flash Free Tier:** 1 request per 62 seconds minimum
✅ **429 Retry delay:** 65 seconds
✅ **Automatic fallback:** Groq Llama 3.3 70b after 2 failed attempts

**Usage:**
```bash
node scripts/enrich-courses.js
node scripts/enrich-courses.js --course albertmelbourne
node scripts/enrich-courses.js --description
```

---

## Setup Instructions

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file in project root:
```
GEMINI_API_KEY=your_google_api_key
GROQ_API_KEY=your_groq_api_key
```

3. Run enrichment script:
```bash
node scripts/enrich-courses.js
```

---

## Known Issues & Workarounds

| Issue | Status | Workaround |
|-------|--------|------------|
| Gemini 429 after 1 request | ✅ Fixed | 62s delay implemented |
| Hardcoded API keys | ✅ Fixed | Using dotenv environment variables |
| KML path only extracts first 2.5km | ✅ Fixed | Automatic path extension to 5km |

---

## Current State (27 April 2026)
- ✅ All API keys properly secured
- ✅ Rate limits updated to current Google restrictions
- ✅ 7 courses fully enriched
- ✅ Database contains ~400 Australian parkrun courses

---

## IMPORTANT NOTES FOR FUTURE TASKS
1. **ALWAYS** check this file first before starting any work
2. Gemini rate limits are subject to change without notice
3. Never commit `.env` file (it is in .gitignore)
4. Full course enrichment takes ~7 hours for 400 courses