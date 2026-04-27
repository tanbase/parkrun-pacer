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

## Technology Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Database | SQLite + SQL.js (in-browser WASM) |
| LLM APIs | Google Gemini 2.5 Flash, Groq Llama 3.3 70b |
| GIS | OpenTopoData elevation API |
| Parser | Cheerio |

---

## Key Architectural Decisions

✅ **Client-side only architecture:**
No backend server required. All calculations run entirely in browser. SQLite database file is loaded directly via WASM.

✅ **Separate data processing pipeline:**
All data enrichment is done offline via node.js scripts. Frontend only consumes pre-calculated static data.

✅ **Single source of truth:**
`courses.json` is the canonical database. All scripts modify this single file.

---

## Course Difficulty Calculation Logic

### Elevation Profile Analysis
1.  Extract full 5km KML path from Google Maps
2.  Resample path to exactly 100 evenly spaced points
3.  Fetch elevation for each point from OpenTopoData
4.  Calculate elevation gain/loss by summing all positive/negative differentials between consecutive points
5.  Remove noise and elevation anomalies

### Course Comparison Formula
Courses are ranked using normalized difficulty score:
```
Difficulty Score = (Elevation Gain * 2.2) + (Elevation Loss * 0.8)
```

All courses are benchmarked against:
- 🔵 **Flat:** <30m total gain
- 🟢 **Easy:** 30-60m gain
- 🟡 **Moderate:** 60-100m gain
- 🟠 **Hard:** 100-150m gain
- 🔴 **Very Hard:** >150m gain

Elevation gain is the single strongest predictor of finish time variance between parkruns.

---

## Current State (27 April 2026)
- ✅ All API keys properly secured
- ✅ Rate limits updated to current Google restrictions
- ✅ 7 courses fully enriched with elevation and LLM descriptions
- ✅ Database contains ~400 Australian parkrun courses

---

## IMPORTANT NOTES FOR FUTURE TASKS
1. **ALWAYS** check this file first before starting any work
2. Gemini rate limits are subject to change without notice
3. Never commit `.env` file (it is in .gitignore)
4. Full course enrichment takes ~7 hours for 400 courses