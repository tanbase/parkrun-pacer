#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

const COURSES_JSON_PATH = path.join(process.cwd(), 'src/data/courses.json');
const EVENTS_JSON_PATH = path.join(process.cwd(), 'src/data/rawdata/events.json');
const RAW_DATA_DIR = path.join(process.cwd(), 'src/data/rawdata');
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EARTHENGINE_CLIENT_EMAIL = process.env.EARTHENGINE_CLIENT_EMAIL;
const EARTHENGINE_PRIVATE_KEY = process.env.EARTHENGINE_PRIVATE_KEY;
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;
let USE_GEMINI = true;

// Set to true for testing: only process first course, exit immediately
const TEST_SINGLE_COURSE = false;

// Number of elevation points to sample per course (200 for finer resolution)
const ELEVATION_POINTS = 201;

// Parse command line arguments
const args = process.argv.slice(2);
const RUN_DESCRIPTION = args.includes('--description') || args.length === 0;
const RUN_ELEVATION = args.includes('--elevation') || args.length === 0;
const COURSE_ID = args.find((arg, idx) => idx > 0 && args[idx - 1] === '--course');
const ELEVATION_SOURCE = args.find((arg, idx) => idx > 0 && args[idx - 1] === '--elevation-source');

// Validate elevation source if provided
if (ELEVATION_SOURCE && !['strava', 'earthengine', 'opentopo'].includes(ELEVATION_SOURCE)) {
  console.error(`❌ Invalid elevation source: ${ELEVATION_SOURCE}`);
  console.error(`Valid sources: strava, earthengine, opentopo`);
  process.exit(1);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node enrich-courses.js [options]

Options:
  --description    Only run course description / terrain LLM parsing
  --elevation      Only run KML elevation profile extraction
  --course <id>    Only process specified course id
  --elevation-source <source>  Preferred elevation source: strava, earthengine, opentopo
  --help           Show this help message

Default: runs both description and elevation modes for all courses`);
  process.exit(0);
}

async function llmParseCourse(rawDescription, currentIndex, totalCourses) {
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
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`  ⏳ Retrying Gemini after rate limit (attempt ${attempt+1}/2)`);
          await new Promise(r => setTimeout(r, 72000));
        }

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
            // Gemini free tier requires 62 second minimum delay between requests (April 2026)
            // Only delay if there is another course to process after this one
            if (RUN_DESCRIPTION && !TEST_SINGLE_COURSE && currentIndex !== undefined && totalCourses !== undefined) {
              if (currentIndex < totalCourses - 1) {
                await new Promise(r => setTimeout(r, 62000));
              }
            }
            return parsed;
          } catch (parseError) {
            console.log(`  ❌ Gemini JSON parse failed:`, parseError.message);
            console.log(`  ❌ Raw content was:`, content);
            break;
          }
        } else if (res.status === 429) {
          console.log(`  ⚠️  Gemini rate limit hit (429)`);
          continue;
        } else {
          const errorBody = await res.text();
          console.log(`  ❌ Gemini error response:`, errorBody);
          break;
        }
      } catch (e) {
        console.log(`  ⚠️  Gemini failed: ${e.message}`);
        break;
      }
    }
    
    console.log(`  ⚠️  Gemini failed after 2 attempts, falling back to Groq`);
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
    terrain: 'Unspecified',
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

import ee from '@google/earthengine';

// Auth is reused across batches — only authenticate once
let eeInitializingPromise = null;
let eeInitialized = false;

async function ensureEarthEngineAuth() {
  if (eeInitialized) return;
  if (eeInitializingPromise) return eeInitializingPromise;

  eeInitializingPromise = new Promise((resolve, reject) => {
    const privateKey = {
      client_email: EARTHENGINE_CLIENT_EMAIL,
      private_key: EARTHENGINE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };

    ee.data.authenticateViaPrivateKey(
      privateKey,
      () => {
        console.log(`  🔑 Auth successful, initializing...`);
        ee.initialize(null, null, () => {
          eeInitialized = true;
          resolve();
        }, reject);
      },
      reject
    );
  });

  return eeInitializingPromise;
}

async function getElevationFromEarthEngine(points) {
  if (!EARTHENGINE_CLIENT_EMAIL || !EARTHENGINE_PRIVATE_KEY) {
    console.log(`  ℹ️  Earth Engine credentials not configured, skipping`);
    return null;
  }

  try {
    console.log(`  🔑 Authenticating with Earth Engine...`);

    // Add 60 second timeout for auth - Earth Engine can be very slow on first connection
    await Promise.race([
      ensureEarthEngineAuth(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Earth Engine auth timed out after 60s')), 60000))
    ]);

    console.log(`  ✅ Earth Engine authenticated successfully`);
    console.log(`  📡 Earth Engine GA Australia 5m LiDAR request for ${points.length} points`);

    // AU/GA/AUSTRALIA_5M_DEM is an ImageCollection — must use mosaic() to composite
    // into a single Image before calling reduceRegion
    const collection = ee.ImageCollection('AU/GA/AUSTRALIA_5M_DEM');
    const dem = collection.mosaic().select('elevation');

    // Send all points in a single batch request using reduceRegions — much faster than
    // one request per point. Index property preserves order since output is unordered.
    const featureCollection = ee.FeatureCollection(
      points.map((point, i) =>
        ee.Feature(ee.Geometry.Point([point.lon, point.lat]), { index: i })
      )
    );

    const sampled = await Promise.race([
      new Promise((resolve, reject) => {
        dem.reduceRegions({
          collection: featureCollection,
          reducer: ee.Reducer.first(),
          scale: 5,
        }).evaluate((result, err) => {
          if (err) reject(new Error(String(err)));
          else resolve(result);
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Earth Engine request timed out after 90s')), 90000))
    ]);

    // Map results back by index to preserve original point order
    const elevationMap = {};
    for (const feature of sampled.features) {
      elevationMap[feature.properties.index] = feature.properties.first;
    }

    const elevations = points.map((_, i) => {
      const val = elevationMap[i];
      return val !== null && val !== undefined ? Math.round(val) : null;
    });

    const successCount = elevations.filter(e => e !== null).length;
    console.log(`  ✅ Earth Engine returned ${successCount}/${elevations.length} valid elevation points`);

    if (successCount > 0) {
      return elevations;
    }
  } catch (e) {
    console.log(`  ⚠️  Earth Engine failed: ${e.message}`);
  }

  return null;
}

let stravaAccessToken = null;
let stravaTokenExpiry = 0;
let stravaRefreshToken = STRAVA_REFRESH_TOKEN; // loaded from env/config

async function getStravaAccessToken() {
  if (stravaAccessToken && Date.now() < stravaTokenExpiry) {
    return stravaAccessToken;
  }
  try {
    console.log(`  📡 Requesting Strava access token...`);
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        refresh_token: stravaRefreshToken,
        grant_type: 'refresh_token'
      })
    });
    if (res.ok) {
      const data = await res.json();
      stravaAccessToken = data.access_token;
      stravaTokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
      // ✅ Persist the new refresh token Strava returns
      stravaRefreshToken = data.refresh_token;
      console.log(`  ✅ Strava authenticated successfully`);
      return stravaAccessToken;
    } else {
      const errBody = await res.text(); // helpful for debugging
      console.log(`  ⚠️  Strava auth failed: ${res.status} ${res.statusText} — ${errBody}`);
      return null;
    }
  } catch (e) {
    console.log(`  ⚠️  Strava auth error: ${e.message}`);
    return null;
  }
}

async function getStravaSegmentForCourse(lat, lon) {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    console.log(`  ℹ️  Strava credentials not configured, skipping`);
    return null;
  }

  const accessToken = await getStravaAccessToken();
  if (!accessToken) return null;

  // 800m bounding box around course centre
  const offset = 0.008; // approx 800m
  const bounds = `${lat - offset},${lon - offset},${lat + offset},${lon + offset}`;

  try {
    console.log(`  📡 Searching Strava segments in area: ${bounds}`);
    const res = await fetch(`https://www.strava.com/api/v3/segments/explore?bounds=${bounds}&activity_type=running&min_cat=0&max_cat=5`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.segments && data.segments.length > 0) {
        // Find best segment ~5km length (4.0km to 6.0km) with parkrun in name
        const candidates = data.segments.filter(s => 
          s.distance >= 4000 && 
          s.distance <= 6000 &&
          /park\W*run/i.test(s.name)
        );
        
        if (candidates.length > 0) {
          // Sort by closest to 5000m
          candidates.sort((a, b) => Math.abs(a.distance - 5000) - Math.abs(b.distance - 5000));
          const best = candidates[0];
          
          console.log(`  ✅ Found Strava segment: ${best.name} (${Math.round(best.distance)}m)`);
          if (best.elev_gain !== undefined && best.elev_gain !== null && !isNaN(best.elev_gain)) {
            console.log(`  ✅ Strava native elevation: +${Math.round(best.elev_gain)}m gain`);
          } else {
            console.log(`  ℹ️  Strava segment has no elevation gain data`);
          }
          
          // Decode polyline
          const decoded = polyline.decode(best.points);
          const points = decoded.map(([lat, lon]) => ({ lat, lon }));
          
           // Also fetch elevation stream for this segment
           try {
            console.log(`  📡 Fetching Strava elevation stream for segment ${best.id}`);
            const streamRes = await fetch(`https://www.strava.com/api/v3/segments/${best.id}/streams/altitude?resolution=high`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            
            if (streamRes.ok) {
              const streamData = await streamRes.json();
              const altitudeStream = streamData.find(s => s.type === 'altitude');
              
              if (altitudeStream && altitudeStream.data && altitudeStream.data.length >= 10) {
                console.log(`  ✅ Got ${altitudeStream.data.length} native elevation points from Strava`);
                
                // Resample Strava elevation to exactly ELEVATION_POINTS
                const stravaElevations = [];
                const elevationCount = altitudeStream.data.length;
                
                for (let i = 0; i < ELEVATION_POINTS; i++) {
                  const idx = Math.round((i / (ELEVATION_POINTS - 1)) * (elevationCount - 1));
                  stravaElevations.push(Math.round(altitudeStream.data[idx]));
                }

                return {
                  id: best.id,
                  points: points,
                  elevations: stravaElevations,
                  elevationGain: Math.round(best.elev_gain)
                };
              }
            }
          } catch (streamErr) {
            console.log(`  ⚠️  Failed to get Strava elevation stream: ${streamErr.message}`);
          }
          
          // Fallback if elevation stream not available
          return { 
            id: best.id,
            points: points 
          };
        }
      }
      
      console.log(`  ℹ️  No suitable Strava segments found`);
      return null;
    } else {
      console.log(`  ⚠️  Strava API failed: ${res.status} ${res.statusText}`);
      return null;
    }
  } catch (e) {
    console.log(`  ⚠️  Strava search error: ${e.message}`);
    return null;
  }
}

function interpolateNullElevations(elevations) {
  const result = [...elevations];
  
  // Forward pass
  let lastValid = null;
  for (let i = 0; i < result.length; i++) {
    if (result[i] !== null && !isNaN(result[i])) {
      lastValid = result[i];
    } else if (lastValid !== null) {
      result[i] = lastValid;
    }
  }
  
  // Backward pass
  lastValid = null;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i] !== null && !isNaN(result[i])) {
      lastValid = result[i];
    } else if (lastValid !== null) {
      result[i] = lastValid;
    }
  }
  
  // Linear interpolate gaps properly
  let i = 0;
  while (i < result.length) {
    if (result[i] === null) {
      let left = i - 1;
      let right = i + 1;
      
      while (left >= 0 && result[left] === null) left--;
      while (right < result.length && result[right] === null) right++;
      
      if (left >= 0 && right < result.length) {
        const distance = right - left;
        for (let j = left + 1; j < right; j++) {
          const t = (j - left) / distance;
          result[j] = Math.round(result[left] + (result[right] - result[left]) * t);
        }
        i = right;
        continue;
      }
    }
    i++;
  }
  
  return result;
}

async function getElevationForPoints(points) {
  const batches = [];
  for (let i = 0; i < points.length; i += 100) {
    batches.push(points.slice(i, i + 100));
  }

  // Build source order according to preference
  let sources = ['earthengine', 'opentopo'];
  
  if (ELEVATION_SOURCE === 'earthengine') {
    sources = ['earthengine', 'strava', 'opentopo'];
  } else if (ELEVATION_SOURCE === 'opentopo') {
    sources = ['opentopo', 'strava', 'earthengine'];
  }

  if (ELEVATION_SOURCE) {
    console.log(`  🎯 Using preferred elevation source order: ${sources.join(' → ')}`);
  }

  const allElevations = [];

  for (const batch of batches) {
    for (const source of sources) {
      if (source === 'earthengine') {
        // 🔴 Try Google Earth Engine GA LiDAR
        const eeResults = await getElevationFromEarthEngine(batch);
        
        if (eeResults) {
          eeResults.forEach(elev => allElevations.push(elev));
          // Only delay if there are more batches to process
          const batchIndex = batches.indexOf(batch);
          if (batchIndex < batches.length - 1) {
            await new Promise(r => setTimeout(r, 300));
          }
          break;
        }
      }

      if (source === 'opentopo') {
        // 🟡 Try OpenTopoData SRTM
        console.log(`  📡 Trying OpenTopoData for ${batch.length} points`);
        const locations = batch.map(p => `${p.lat},${p.lon}`).join('|');
        try {
          const res = await fetch(`https://api.opentopodata.org/v1/srtm90m?locations=${locations}`);
          console.log(`  📡 OpenTopoData status: ${res.status} ${res.statusText}`);
          
          const text = await res.text();
          
          let data;
          try {
            data = JSON.parse(text);
          } catch (jsonError) {
            console.log(`  ❌ Invalid JSON response: ${jsonError.message}`);
            continue;
          }
          
          if (data.results) {
            console.log(`  ✅ Got ${data.results.length} elevation results`);
            data.results.forEach(r => allElevations.push(Math.round(r.elevation)));
            await new Promise(r => setTimeout(r, 1200));
            break;
          } else if (data.error) {
            console.log(`  ❌ API error: ${data.error}`);
          }
        } catch (e) {
          console.log(`⚠️  Elevation batch failed: ${e.message}`);
        }
      }
    }
  }

  // Interpolate any remaining null points
  const filledElevations = interpolateNullElevations(allElevations);
  
  const invalidCount = filledElevations.filter(e => e === null).length;
  if (invalidCount > 0) {
    console.log(`  ℹ️  Interpolated ${invalidCount} null elevation points`);
  }

  return filledElevations;
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

function resamplePathByDistance(points, numPoints = 100) {
  if (points.length < 2) return points;

  // Calculate cumulative distances for each point
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i-1] + calculateDistance(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon));
  }

  const totalLength = cumulative[cumulative.length - 1];
  if (totalLength <= 0) return points.slice(0, numPoints);

  const resampled = [];

  // Sample exactly `numPoints` evenly spaced points along path
  for (let i = 0; i < numPoints; i++) {
    const targetDistance = (totalLength * i) / Math.max(numPoints - 1, 1);

    // Binary search to find correct segment (O(log n) instead of O(n))
    let low = 0, high = cumulative.length - 1;
    let segmentIndex = 0;
    
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid] <= targetDistance) {
        segmentIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // Handle edge case when we exactly hit last point
    if (segmentIndex >= cumulative.length - 1) {
      resampled.push({ ...points[points.length - 1] });
      continue;
    }

    // Linear interpolate between the two points
    const segmentStart = cumulative[segmentIndex];
    const segmentEnd = cumulative[segmentIndex + 1];
    const segmentLength = segmentEnd - segmentStart;
    
    const t = segmentLength <= 0 ? 0 : Math.max(0, Math.min(1, (targetDistance - segmentStart) / segmentLength));

    const p1 = points[segmentIndex];
    const p2 = points[segmentIndex + 1];

    resampled.push({
      lat: p1.lat + (p2.lat - p1.lat) * t,
      lon: p1.lon + (p2.lon - p1.lon) * t
    });
  }

  // Guarantee first and last points are exactly matching original endpoints
  resampled[0] = { ...points[0] };
  resampled[resampled.length - 1] = { ...points[points.length - 1] };

  return resampled;
}

function extendPathToFullDistance(points, targetDistance = 5000) {
  const pathDistance = calculatePathTotalDistance(points);
  
  if (pathDistance >= 3500) {
    // Only automatically extend courses that are clearly half lap or shorter (<3.5km)
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

function smoothElevation(elevations, windowSize = 5) {
  if (!elevations || elevations.length < windowSize) return elevations;
  
  const smoothed = [];
  const halfWindow = Math.floor(windowSize / 2);
  
  for (let i = 0; i < elevations.length; i++) {
    let sum = 0;
    let count = 0;
    
    // Average over window, handling edges
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(elevations.length - 1, i + halfWindow); j++) {
      if (elevations[j] !== null && elevations[j] !== undefined) {
        sum += elevations[j];
        count++;
      }
    }
    
    smoothed.push(count > 0 ? Math.round(sum / count) : elevations[i]);
  }
  
  return smoothed;
}

function removeElevationOutliers(elevations, thresholdMeters = 10) {
  if (!elevations || elevations.length < 3) return elevations;
  
  const filtered = [...elevations];
  
  // Pass 1: forward - remove spikes that are unlikely (diff > threshold from both neighbors)
  for (let i = 1; i < filtered.length - 1; i++) {
    const prev = filtered[i - 1];
    const curr = filtered[i];
    const next = filtered[i + 1];
    
    if (curr !== null && prev !== null && next !== null) {
      const diffPrev = Math.abs(curr - prev);
      const diffNext = Math.abs(curr - next);
      
      // If this point is an outlier compared to both neighbors, replace with average
      if (diffPrev > thresholdMeters && diffNext > thresholdMeters) {
        filtered[i] = Math.round((prev + next) / 2);
      }
    }
  }
  
  return filtered;
}

function calculateElevationProfile(elevations) {
  if (!elevations || elevations.length < 2) return { gain: 0, loss: 0, min: 0, max: 0 };

  // Correct order: remove outliers first, THEN smooth
  let processedElevations = removeElevationOutliers(elevations, 10);
  processedElevations = smoothElevation(processedElevations, 3); // Reduced window from 5 → 3

  let gain = 0;
  let loss = 0;
  let prev = processedElevations[0];

  for (let i = 1; i < processedElevations.length; i++) {
    const diff = processedElevations[i] - prev;
    if (diff > 0.5) gain += diff; // Reduced threshold from 1m → 0.5m
    if (diff < -0.5) loss += Math.abs(diff);
    prev = processedElevations[i];
  }

  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
    min: Math.round(Math.min(...processedElevations)),
    max: Math.round(Math.max(...processedElevations))
  };
}

import unzipper from 'unzipper';
import polyline from '@mapbox/polyline';

async function processCourse(course, eventData, processedCourses, totalToProcess) {
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
        const llmResult = await llmParseCourse(enriched.rawDescription, processedCourses.length, totalToProcess);
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
          enriched.mapEmbedUrl = src;
          // New public KML endpoint works for older maps created before April 2026
          // Newer maps require authentication and return 404
          enriched.kmlUrl = `https://www.google.com/maps/d/kml?forcekml=1&mid=${enriched.mapMid}`;
          console.log(`  ✅ Found Google Maps mid: ${enriched.mapMid}`);
        }
      }

      // Always try Strava segments FIRST (better quality, more accurate paths)
      if (enriched.latitude && enriched.longitude && RUN_ELEVATION) {
        let stravaResult = null;
        
        // If manual Strava segment ID is already set, use that directly
        if (enriched.stravaSegmentId) {
          console.log(`  ✅ Using manual Strava segment ID: ${enriched.stravaSegmentId}`);
          try {
            const accessToken = await getStravaAccessToken();
            if (accessToken) {
              console.log(`  📡 Fetching Strava segment ${enriched.stravaSegmentId}`);
              const segmentRes = await fetch(`https://www.strava.com/api/v3/segments/${enriched.stravaSegmentId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              });
              
              if (segmentRes.ok) {
                const best = await segmentRes.json();
                console.log(`  ✅ Found Strava segment: ${best.name} (${Math.round(best.distance)}m)`);
                if (best.elev_gain !== undefined && best.elev_gain !== null && !isNaN(best.elev_gain)) {
                  console.log(`  ✅ Strava native elevation: +${Math.round(best.elev_gain)}m gain`);
                }
                
                // Decode polyline from map.polyline (always present on modern Strava API)
                const polylineStr = best.map?.polyline || best.points;
                const decoded = polyline.decode(polylineStr);
                const points = decoded.map(([lat, lon]) => ({ lat, lon }));
                
                // Also fetch elevation stream for this segment
                try {
                  console.log(`  📡 Fetching Strava elevation stream for segment ${best.id}`);
                  const streamRes = await fetch(`https://www.strava.com/api/v3/segments/${best.id}/streams/altitude?resolution=high`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                  });
                  
                  if (streamRes.ok) {
                    const streamData = await streamRes.json();
                    const altitudeStream = Array.isArray(streamData) ? streamData.find(s => s.type === 'altitude') : null;
                    
                    if (altitudeStream && altitudeStream.data && Array.isArray(altitudeStream.data) && altitudeStream.data.length >= 10) {
                      console.log(`  ✅ Got ${altitudeStream.data.length} native elevation points from Strava`);
                      
                      // Resample Strava elevation to exactly ELEVATION_POINTS
                      const stravaElevations = [];
                      const elevationCount = altitudeStream.data.length;
                      
                      for (let i = 0; i < ELEVATION_POINTS; i++) {
                        const idx = Math.round((i / (ELEVATION_POINTS - 1)) * (elevationCount - 1));
                        stravaElevations.push(Math.round(altitudeStream.data[idx]));
                      }
          
                      stravaResult = {
                        id: best.id,
                        points: points,
                        elevations: stravaElevations,
                        elevationGain: Math.round(best.elev_gain)
                      };
                    }
                  }
                } catch (streamErr) {
                  console.log(`  ⚠️  Failed to get Strava elevation stream: ${streamErr.message}`);
                }
                
                // Fallback if elevation stream not available
                if (!stravaResult) {
                  stravaResult = { 
                    id: best.id,
                    points: points 
                  };
                }
              }
            }
          } catch (e) {
            console.log(`  ⚠️  Manual Strava segment lookup failed: ${e.message}`);
            stravaResult = null;
          }
        }
        
        // If no manual segment ID or lookup failed, try normal search
        if (!stravaResult) {
          stravaResult = await getStravaSegmentForCourse(enriched.latitude, enriched.longitude);
        }
        
        if (stravaResult) {
          const { id: stravaSegmentId, points: stravaPoints, elevations: stravaElevations, elevationGain } = stravaResult;
          
          // Save Strava segment ID
          enriched.stravaSegmentId = stravaSegmentId;
          
          if (stravaPoints && stravaPoints.length >= 5) {
            console.log(`  ✅ Using Strava segment path with ${stravaPoints.length} points`);
            
            // Resample to exactly ELEVATION_POINTS perfectly evenly spaced points by actual distance
            const resampled = resamplePathByDistance(stravaPoints, ELEVATION_POINTS);

            // Store the actual course path coordinates first
            enriched.coursePath = resampled.map(p => [p.lat, p.lon]);

            // Use native Strava elevation only if allowed by source preference
            if (stravaElevations && stravaElevations.length >= 90 && 
                (!ELEVATION_SOURCE || ELEVATION_SOURCE === 'strava')) {
              console.log(`  ✅ Using native Strava elevation data`);
              enriched.elevationProfile = stravaElevations;
              
              const profile = calculateElevationProfile(stravaElevations);
              enriched.elevationGain = elevationGain || profile.gain;
              enriched.elevationLoss = profile.loss;
              enriched.minElevation = profile.min;
              enriched.maxElevation = profile.max;
              const validStravaElevations = stravaElevations.filter(e => e !== null && !isNaN(e));
              if (validStravaElevations.length > 0) {
                enriched.elevation = Math.round(validStravaElevations.reduce((a,b) => a + b, 0) / validStravaElevations.length);
              }
            } else {
              // Fallback: query elevation APIs
              console.log(`  📡 Fetching elevation profile for ${ELEVATION_POINTS} points`);
              const elevations = await getElevationForPoints(resampled);
              
              console.log(`  📡 Got ${elevations.length} elevation points returned from API`);
              
              if (elevations.length > 0) {
                enriched.elevationProfile = elevations;
                const profile = calculateElevationProfile(elevations);
                
                enriched.elevationGain = elevationGain || profile.gain;
                enriched.elevationLoss = profile.loss;
                enriched.minElevation = profile.min;
                enriched.maxElevation = profile.max;
                const validElevations = elevations.filter(e => e !== null && !isNaN(e));
              if (validElevations.length > 0) {
                enriched.elevation = Math.round(validElevations.reduce((a,b) => a + b, 0) / validElevations.length);
              }
              }
            }

            console.log(`  ✅ Elevation profile loaded: +${enriched.elevationGain}m / -${enriched.elevationLoss}m`);
            console.log(`  ✅ Saved ${resampled.length} path coordinates and elevation points`);
          }
        }
      }

      // Only try KML download if Strava failed
      if (!enriched.coursePath && enriched.kmlUrl && RUN_ELEVATION) {
        try {
          console.log(`  📥 Downloading KML course path from: ${enriched.kmlUrl}`);
          const kmlRes = await fetch(enriched.kmlUrl, { 
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          console.log(`  📥 KML response status: ${kmlRes.status} ${kmlRes.statusText}`);
          
          if (kmlRes.ok) {
            // Google returns KMZ format (ZIP compressed KML)
            const buffer = Buffer.from(await kmlRes.arrayBuffer());
            console.log(`  📥 Downloaded ${buffer.length} bytes`);
            
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
              console.log(`  ℹ️  Not a KMZ archive, treating as plain KML: ${zipError.message}`);
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
                // First extend path to full 5000m course (handles laps, out-and-back)
                const extendedPoints = extendPathToFullDistance(points);
                
                // Always resample the extended full-length path, not the original short path
                // This guarantees even spacing even for short original paths that get extended
                const resampled = resamplePathByDistance(extendedPoints, ELEVATION_POINTS);

                // Store the actual course path coordinates first
                enriched.coursePath = resampled.map(p => [p.lat, p.lon]);

                // Get elevation for all points
                console.log(`  📡 Fetching elevation profile for ${ELEVATION_POINTS} points`);
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
    // Fallback: use Open Topo Data SRTM for approximate elevation
    try {
      const res = await fetch(`https://api.opentopodata.org/v1/srtm90m?locations=${enriched.latitude},${enriched.longitude}`);
      const text = await res.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonError) {
        console.log(`  ❌ Open Topo Data returned invalid JSON`);
        console.log(`  📄 Response status: ${res.status} ${res.statusText}`);
        throw new Error('Invalid JSON response');
      }
      
      if (data.results && data.results[0]) {
        enriched.elevation = Math.round(data.results[0].elevation);
        console.log(`  ✅ Fallback elevation: ${enriched.elevation}m`);
      } else if (data.error) {
        console.log(`  ❌ Open Topo Data API error: ${data.error}`);
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

  // Calculate actual number of courses that will be processed
  let totalToProcess = 0;
  for (let i = 0; i < courses.length; i++) {
    if (!COURSE_ID || courses[i].id === COURSE_ID) {
      totalToProcess++;
    }
  }

  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    
    // Skip if specific course id is requested and this doesn't match
    if (COURSE_ID && course.id !== COURSE_ID) {
      outputCourses.push(course);
      continue;
    }

    const enriched = await processCourse(course, eventData, processedCourses, totalToProcess);
    outputCourses.push(enriched);
    processedCourses.push(enriched);
    
    if (TEST_SINGLE_COURSE) {
      console.log(`\n🧪 Test mode active: only processed 1 course, stopping now`);
      break;
    }
  }

  // Write back updated courses
  await fs.writeJson(COURSES_JSON_PATH, outputCourses, { spaces: 2 });

  console.log(`\n✅ Complete! Updated ${processedCourses.length} courses`);
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

  // Force process exit to work around Earth Engine client hanging
  // EE client keeps persistent HTTP connections alive which prevent Node from exiting
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});