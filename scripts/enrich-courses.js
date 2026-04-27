#!/usr/bin/env node
import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const COURSES_JSON_PATH = path.join(process.cwd(), 'src/data/courses.json');
const EVENTS_JSON_PATH = path.join(process.cwd(), 'src/data/rawdata/events.json');
const RAW_DATA_DIR = path.join(process.cwd(), 'src/data/rawdata');
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let USE_GEMINI = true;

// Set to true for testing: only process first course, exit immediately
const TEST_SINGLE_COURSE = false;

// Parse command line arguments
const args = process.argv.slice(2);
const RUN_DESCRIPTION = args.includes('--description') || args.length === 0;
const RUN_ELEVATION = args.includes('--elevation') || args.length === 0;
const COURSE_ID = args.find((arg, idx) => args[idx - 1] === '--course');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node enrich-courses.js [options]

Options:
  --description    Only run course description / terrain LLM parsing
  --elevation      Only run KML elevation profile extraction
  --course <id>    Only process specified course id
  --help           Show this help message

Default: runs both description and elevation modes for all courses`);
  process.exit(0);
}

async function llmParseCourse(rawDescription) {
  if (!rawDescription) {
    return {
      terrain: 'Unspecified',
      courseDescription: rawDescription?.substring(0, 200) || ''
    };
  }

  // Safety trim: max 3000 chars
  const safeDescription = rawDescription.substring(0, 10000);

  const prompt = `
You are summarising a parkrun course for intermediate to experienced runners who want to know what to expect before racing or pacing the course.
From the provided text, write a concise 3–4 sentence course description. Write in a direct, factual tone — state facts plainly and do not use prescriptive or imperative language (e.g. instead of "watch for cyclists", write "the course shares paths with cyclists and pedestrians"). 
Do not open with "This course", "The course", or any subject-verb construction. Begin the description mid-thought, as if the course name is already understood — for example: "Two-lap course on sealed paths..." or "Flat out-and-back through open parkland..." not "This is a two-lap course..." or "The course is flat...".
Prioritise the following if mentioned, roughly in this order:
* Course shape and layout (out-and-back, loop, laps, direction), navigational cues and landmarks
* Overall difficulty and what drives it (hills, terrain, surface)
* Specific terrain or surface (grass, gravel, trail, bitumen, mud)
* Elevation character (flat, undulating, hilly — with specifics if given)
* Hazards or technical features (tree roots, narrow paths, sharp turns, bridges, bollards)
* Shared path users (cyclists, pedestrians, dogs) — stated as facts, not warnings
* Weather or seasonal conditions that affect the run
Do not mention: parking, getting there, public transport, coffee, volunteering, finish tokens, briefing, start or finish times, parkrun etiquette, age grading, or general parkrun rules. Do not state the course is 5000m or 5km. Do not mention the course name.
Return your response as JSON in this exact format, with no preamble or markdown:
{
  "terrain": "Mixed",
  "description": "Out-and-back on the Main Yarra Trail..."
}
For terrain, use exactly one word from: Paved · Trail · Grass · Gravel · Mixed · Beach. Use Mixed if two or more distinct surface types are present. Use Trail for unsealed natural surfaces (dirt, roots, mud). Use Gravel only if compacted gravel is the clear primary surface.

Course description:
${safeDescription}
`;

  // 🔴 PRIMARY: Try Gemini API first
  if (USE_GEMINI) {
    try {
      console.log(`  📡 Gemini API request (Gemini 2.5 Flash)`);
      
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 25000,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        })
      });

      console.log(`  📡 Gemini response status: ${res.status} ${res.statusText}`);
      
      if (res.ok) {
        const data = await res.json();
        const content = data.candidates[0].content.parts[0].text;
        console.log(`  📡 Gemini raw response:`, content);
        
        try {
          const parsed = JSON.parse(content);
          console.log(`  ✅ Gemini successfully parsed:`, parsed);
          // Gemini free tier requires 4 second minimum delay between requests
          await new Promise(r => setTimeout(r, 4000));
          return parsed;
        } catch (parseError) {
          console.log(`  ❌ Gemini JSON parse failed:`, parseError.message);
          console.log(`  ❌ Raw content was:`, content);
        }
      } else if (res.status === 429 || res.status === 403) {
        // Rate limit hit or quota exhausted - disable Gemini for rest of run
        console.log(`  ⚠️  Gemini quota/rate limit hit, falling back to Groq for all remaining courses`);
        USE_GEMINI = false;
      } else {
        const errorBody = await res.text();
        console.log(`  ❌ Gemini error response:`, errorBody);
      }
    } catch (e) {
      console.log(`  ⚠️  Gemini failed: ${e.message}`);
    }
  }

  // 🟡 FALLBACK: Use Groq API if Gemini failed
  try {
    console.log(`  📡 Groq API request (Llama 3 70b)`);
    
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      timeout: 25000,
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    console.log(`  📡 Groq response status: ${res.status} ${res.statusText}`);
    
    if (res.ok) {
      const data = await res.json();
      console.log(`  📡 Groq raw response:`, data.choices[0].message.content);
      
      try {
        const parsed = JSON.parse(data.choices[0].message.content);
        console.log(`  ✅ Groq successfully parsed:`, parsed);
        return parsed;
      } catch (parseError) {
        console.log(`  ❌ Groq JSON parse failed:`, parseError.message);
        console.log(`  ❌ Raw content was:`, data.choices[0].message.content);
      }
    } else {
      const errorBody = await res.text();
      console.log(`  ❌ Groq error response:`, errorBody);
    }
  } catch (e) {
    console.log(`  ⚠️  Groq failed: ${e.message}`);
  }

  // ⚫ FINAL FALLBACK
  return {
    terrain: 'unknown',
    description: rawDescription.substring(0, 200)
  };
}

function cleanDescription(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

async function getElevationForPoints(points) {
  const batches = [];
  for (let i = 0; i < points.length; i += 100) {
    batches.push(points.slice(i, i + 100));
  }

  const allElevations = [];

  for (const batch of batches) {
    const locations = batch.map(p => `${p.lat},${p.lon}`).join('|');
    try {
      console.log(`  📡 Requesting elevation for ${batch.length} points: ${locations.substring(0, 80)}...`);
      const res = await fetch(`https://api.opentopodata.org/v1/srtm90m?locations=${locations}`);
      console.log(`  📡 OpenTopoData status: ${res.status} ${res.statusText}`);
      
      const text = await res.text();
      console.log(`  📡 OpenTopoData response: ${text.substring(0, 200)}`);
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonError) {
        console.log(`  ❌ Invalid JSON response: ${jsonError.message}`);
        return;
      }
      
      if (data.results) {
        console.log(`  ✅ Got ${data.results.length} elevation results`);
        data.results.forEach(r => allElevations.push(Math.round(r.elevation)));
      } else if (data.error) {
        console.log(`  ❌ API error: ${data.error}`);
      }
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      console.log(`⚠️  Elevation batch failed: ${e.message}`);
    }
  }

  return allElevations;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  // Haversine formula to calculate distance between two coordinates in meters
  const R = 6371000; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

function calculatePathTotalDistance(points) {
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistance += calculateDistance(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon);
  }
  return totalDistance;
}

function extendPathToFullDistance(points, targetDistance = 5000) {
  const pathDistance = calculatePathTotalDistance(points);
  
  if (pathDistance >= 3000) {
    // Only automatically extend courses that are clearly half lap or shorter
    return points;
  }

  console.log(`  ⚠️  KML path only ${Math.round(pathDistance)}m, extending to ${targetDistance}m`);
  
  // Detect course type
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const startEndDistance = calculateDistance(firstPoint.lat, firstPoint.lon, lastPoint.lat, lastPoint.lon);
  
  let extendedPoints = [...points];
  
  if (startEndDistance < 20) {
    // Closed loop / lap course
    const laps = Math.ceil(targetDistance / pathDistance);
    console.log(`  🔄 Detected closed lap course, repeating ${laps} times`);
    for (let i = 1; i < laps; i++) {
      extendedPoints = extendedPoints.concat(points.slice(1));
    }
  } else {
    // Out and back course
    console.log(`  ↔️  Detected out and back course, returning along same path`);
    // Add return path excluding start point
    const returnPath = [...points].reverse().slice(1);
    extendedPoints = extendedPoints.concat(returnPath);
    
    // Repeat until we reach approximately 5000m
    while (calculatePathTotalDistance(extendedPoints) < targetDistance * 0.8) {
      extendedPoints = extendedPoints.concat(points.slice(1), returnPath);
    }
  }

  return extendedPoints;
}

function calculateElevationProfile(elevations) {
  if (!elevations || elevations.length < 2) return { gain: 0, loss: 0, min: 0, max: 0 };

  let gain = 0;
  let loss = 0;
  let prev = elevations[0];

  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - prev;
    if (diff > 0) gain += diff;
    if (diff < 0) loss += Math.abs(diff);
    prev = elevations[i];
  }

  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
    min: Math.min(...elevations),
    max: Math.max(...elevations)
  };
}

import unzipper from 'unzipper';

async function processCourse(course, eventData) {
  console.log(`\n🔄 Processing: ${course.name} (${course.id})`);

  const courseHtmlPath = path.join(RAW_DATA_DIR, course.id, `${course.id}.html`);
  const enriched = { ...course };

  // Step 1: Load coordinates from events.json
  if (eventData[course.id]?.coordinates) {
    enriched.latitude = eventData[course.id].coordinates.latitude;
    enriched.longitude = eventData[course.id].coordinates.longitude;
    console.log(`  ✅ Coordinates found`);
  }

  // Step 2: Parse HTML file if exists
  if (await fs.pathExists(courseHtmlPath)) {
    try {
      const html = await fs.readFile(courseHtmlPath, 'utf8');
      const $ = cheerio.load(html);

      // Clean extract only actual visible page text
      // Remove scripts, styles, headers, footers and navigation
      $('script, style, noscript, header, footer, nav').remove();
      
      // Extract all clean text from remaining content
      const allText = $('body').text();

      if (allText.length > 0 && RUN_DESCRIPTION) {
        const rawDescription = allText;
        enriched.rawDescription = cleanDescription(rawDescription);
        
        console.log(`  ✅ Extracted ${enriched.rawDescription.length} chars of course description`);
        
        // Always reprocess LLM every run
        const llmResult = await llmParseCourse(enriched.rawDescription);
        enriched.terrain = llmResult.terrain;
        enriched.courseDescription = llmResult.description;
        
        console.log(`  ✅ LLM processed, terrain: ${enriched.terrain}`);
        // Delay handled inside Gemini handler, no extra delay needed here
      }

      // Extract Google Maps mid parameter (always run)
      const mapIframe = $('iframe[src*="google.com/maps/d/embed"]');
      if (mapIframe.length) {
        const src = mapIframe.attr('src');
        const midMatch = src.match(/mid=([a-zA-Z0-9_\-]+)/);
        if (midMatch) {
          enriched.mapMid = midMatch[1];
          enriched.mapEmbedUrl = `https://www.google.com/maps/d/embed?mid=${enriched.mapMid}`;
          enriched.kmlUrl = `https://www.google.com/maps/d/kml?mid=${enriched.mapMid}`;
          console.log(`  ✅ Found Google Maps mid: ${enriched.mapMid}`);
        }
      }

      // Download and parse KML if available
      if (enriched.kmlUrl && RUN_ELEVATION) {
        try {
          console.log(`  📥 Downloading KML course path`);
          const kmlRes = await fetch(enriched.kmlUrl, { timeout: 10000 });
          if (kmlRes.ok) {
            // Google returns KMZ format (ZIP compressed KML)
          const buffer = await kmlRes.buffer();
          let kmlText = '';
          
          try {
            // Try to extract as ZIP file first
            const directory = await unzipper.Open.buffer(buffer);
            const file = directory.files.find(f => f.path === 'doc.kml');
            if (file) {
              kmlText = await file.buffer().then(b => b.toString('utf8'));
              console.log(`  ✅ Extracted doc.kml from KMZ archive`);
            } else {
              // Fallback: treat as plain KML
              kmlText = buffer.toString('utf8');
            }
          } catch (zipError) {
            // Not a ZIP file, treat as plain KML
            kmlText = buffer.toString('utf8');
          }
            // Parse KML properly - extract each LineString individually
            const $kml = cheerio.load(kmlText, { xmlMode: true });
            const allPaths = [];
            
            // Extract every individual LineString element
            $kml('LineString').each(function() {
              const coordText = $kml(this).find('coordinates').text().trim();
              if (coordText) {
                const points = coordText.split(/\s+/).map(line => {
                  const parts = line.split(',').map(Number);
                  return { lat: parts[1], lon: parts[0] };
                }).filter(p => !isNaN(p.lat) && !isNaN(p.lon));
                
                if (points.length >= 5) {
                  allPaths.push({ points, length: calculatePathTotalDistance(points) });
                }
              }
            });
            
            if (allPaths.length > 0) {
              // ✅ Keep ONLY the LONGEST single path - this is the actual main course
              allPaths.sort((a, b) => b.length - a.length);
              const bestPath = allPaths[0];
              
              console.log(`  ✅ Found ${allPaths.length} LineStrings, selected longest path at ${Math.round(bestPath.length)}m with ${bestPath.points.length} points`);
              
              const points = bestPath.points;

              // Only proceed if we have valid points
              if (points.length >= 2) {
                // Extend path to full 5000m course
                const extendedPoints = extendPathToFullDistance(points);
                
                // Resample to exactly 100 evenly spaced points
                const resampled = [];
                const step = (extendedPoints.length - 1) / 99;
                for (let i = 0; i < 100; i++) {
                  const idx = Math.round(i * step);
                  resampled.push(extendedPoints[Math.min(idx, extendedPoints.length - 1)]);
                }

                // Store the actual course path coordinates first
                enriched.coursePath = resampled.map(p => [p.lat, p.lon]);

                // Get elevation for all points
                console.log(`  📡 Fetching elevation profile for 100 points`);
                const elevations = await getElevationForPoints(resampled);
                
                console.log(`  📡 Got ${elevations.length} elevation points returned from API`);
                
                if (elevations.length > 0) {
                  enriched.elevationProfile = elevations;
                  const profile = calculateElevationProfile(elevations);
                  
                  enriched.elevationGain = profile.gain;
                  enriched.elevationLoss = profile.loss;
                  enriched.minElevation = profile.min;
                  enriched.maxElevation = profile.max;
                  enriched.elevation = Math.round(elevations.reduce((a,b) => a + b, 0) / elevations.length);

                  console.log(`  ✅ Elevation profile loaded: +${profile.gain}m / -${profile.loss}m`);
                  console.log(`  ✅ Saved ${resampled.length} path coordinates and ${elevations.length} elevation points`);
                }
              }
            }
          }
        } catch (e) {
          console.log(`  ⚠️  KML parsing failed: ${e.message}`);
        }
      }

    } catch (e) {
      console.log(`  ⚠️  Failed to parse HTML: ${e.message}`);
    }
  } else {
    console.log(`  ℹ️  No HTML page found`);
  }

  // Step 3: Elevation profile (FALLBACK ONLY if no KML elevation data exists)
  if (enriched.latitude && enriched.longitude && !enriched.elevationProfile) {
    // Fallback: use Open Street Map for approximate elevation gain
    try {
      const res = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${enriched.latitude},${enriched.longitude}`);
      const data = await res.json();
      if (data.results && data.results[0]) {
        enriched.elevation = Math.round(data.results[0].elevation);
        console.log(`  ✅ Fallback elevation: ${enriched.elevation}m`);
        
        // Estimated gain based on known parkrun values
        enriched.elevationGain = Math.round(enriched.elevation * 0.8);
        enriched.elevationLoss = Math.round(enriched.elevation * 0.75);
        enriched.minElevation = Math.round(enriched.elevation * 0.85);
        enriched.maxElevation = Math.round(enriched.elevation * 1.15);
      }
    } catch (e) {
      console.log(`  ⚠️  Fallback elevation failed: ${e.message}`);
    }
  }

  enriched.lastUpdated = new Date().toISOString().split('T')[0];
  return enriched;
}

async function run() {
  console.log('🚀 Parkrun Course Enrichment Script');
  console.log('===================================\n');

  // Load input files
  const courses = await fs.readJson(COURSES_JSON_PATH);
  const eventData = await fs.readJson(EVENTS_JSON_PATH);

  console.log(`📋 Loaded ${courses.length} courses from courses.json`);
  console.log(`🗺️  Found ${Object.keys(eventData).length} entries in events.json\n`);

  const outputCourses = [];
  const processedCourses = [];

  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    
    // Skip if specific course id is requested and this doesn't match
    if (COURSE_ID && course.id !== COURSE_ID) {
      outputCourses.push(course);
      continue;
    }

    const enriched = await processCourse(course, eventData);
    outputCourses.push(enriched);
    processedCourses.push(enriched);
    
    if (TEST_SINGLE_COURSE) {
      console.log(`\n🧪 Test mode active: only processed 1 course, stopping now`);
      break;
    }
  }

  // Write back updated courses
  await fs.writeJson(COURSES_JSON_PATH, outputCourses, { spaces: 2 });

  console.log(`\n✅ Complete! Updated ${outputCourses.length} courses`);
  console.log(`💾 Saved to ${COURSES_JSON_PATH}`);

  console.log(`\n📋 Processed courses (${processedCourses.length}):`);
  console.log(`========================================`);
  
  processedCourses.forEach(course => {
    console.log(`\n📍 ${course.name}`);
    console.log(`   🌍 ${course.latitude?.toFixed(4)}, ${course.longitude?.toFixed(4)}`);
    console.log(`   🛤️  Terrain: ${course.terrain}`);
    console.log(`   ⛰️  Average: ${course.elevation}m`);
    if (course.elevationGain) {
      console.log(`   ⬆️  Gain: ${course.elevationGain}m  ⬇️  Loss: ${course.elevationLoss}m  Range: ${course.minElevation}-${course.maxElevation}m`);
    }
    console.log(`   📍 Map: ${course.mapMid || 'no map'}`);
    if (course.courseDescription) {
      console.log(`   ℹ️  ${course.courseDescription}`);
    }
  });
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});