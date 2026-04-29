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


## Known Issues & Workarounds

| Issue | Status | Workaround |
|-------|--------|------------|
| Gemini 429 after 1 request | ✅ Fixed | 62s delay implemented |
| Hardcoded API keys | ✅ Fixed | Using dotenv environment variables |
| KML path only extracts first 2.5km | ✅ Fixed | Automatic path extension to 5km |
| Leaflet map doesn't update when selecting different course | ✅ Fixed | Use useEffect with selectedResult dependency to properly clean up and re-initialize map |

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
1.  Extract full 5km KML path from Google Maps (or use Strava segment)
2.  Resample path to exactly 200 evenly spaced points (configurable via ELEVATION_POINTS)
3.  Fetch elevation for each point from Google Earth Engine (LiDAR) or OpenTopoData (SRTM)
4.  Apply 5-point moving average smoothing to reduce noise
5.  Remove outliers (>10m deviation from both neighbors)
6.  Calculate elevation gain/loss by summing all positive/negative differentials between consecutive points

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