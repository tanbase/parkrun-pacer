#!/usr/bin/env node
/**
 * Import raw parkrun HTML results into SQLite database
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAWDATA_DIR = path.join(__dirname, '../src/data/rawdata');
const DB_PATH = path.join(__dirname, '../src/data/parkrun.db');

// Parse filename format: location-eventnumber-yyyymmdd.html
function parseFilename(filename) {
  const match = filename.match(/^([a-z]+)-(\d+)-(\d{8})\.html$/i);
  if (!match) return null;
  
  return {
    courseId: match[1],
    eventNumber: parseInt(match[2]),
    date: `${match[3].substring(0,4)}-${match[3].substring(4,6)}-${match[3].substring(6,8)}`,
    filename
  };
}

async function parseResultsHtml(htmlContent) {
  const dom = new JSDOM(htmlContent);
  const doc = dom.window.document;
  
  // Extract event metadata
  const eventTitle = doc.querySelector('.Results-header h1')?.textContent.trim() || '';
  const eventMeta = doc.querySelector('.Results-header h3')?.textContent.trim() || '';
  const dateMatch = eventMeta.match(/(\d{1,2}\/\d{1,2}\/\d{2})/);
  const eventNumMatch = eventMeta.match(/#(\d+)/);
  
  const finishers = parseInt(doc.querySelector('.statistics-card .value')?.textContent.trim() || '0');
  
  // Extract results table - all data is already in row data attributes!
  const results = [];
  const rows = Array.from(doc.querySelectorAll('*')).filter(el => {
    const cls = el.getAttribute('class');
    return cls && cls.includes('Results-table-row');
  });
  
  for (const row of rows) {
    try {
      // All data is already on the element as clean data-* attributes
      const position = row.getAttribute('data-position');
      const name = row.getAttribute('data-name');
      const ageCategory = row.getAttribute('data-agegroup');
      const ageGrade = row.getAttribute('data-agegrade');
      const gender = row.getAttribute('data-gender');
      const club = row.getAttribute('data-club');
      const totalRuns = row.getAttribute('data-runs');
      const volunteerCount = row.getAttribute('data-vols');
      const achievement = row.getAttribute('data-achievement');
      
      // Time is no longer on data attribute, it's inside child td element
      const timeElement = row.querySelector('.Results-table-td--time .compact');
      const time = timeElement ? timeElement.textContent.trim() : '';
      
      if (!position || !name) continue;
      
      // Parse time to seconds
      let timeSeconds = 0;
      if (time) {
        const timeParts = time.split(':');
        if (timeParts.length === 2) {
          timeSeconds = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);
        } else if (timeParts.length === 3) {
          timeSeconds = parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);
        }
      }
      
      results.push({
        position: parseInt(position),
        name,
        time: time || '',
        timeSeconds,
        ageCategory: ageCategory || '',
        ageGrade: ageGrade ? parseFloat(ageGrade.replace('%', '')) : null,
        gender: gender || '',
        club: club || '',
        totalRuns: totalRuns ? parseInt(totalRuns) : 0,
        volunteerCount: volunteerCount ? parseInt(volunteerCount) : 0,
        achievement: achievement || ''
      });
    } catch (e) {
      // Skip bad rows
      continue;
    }
  }
  
  return {
    eventTitle,
    eventNumber: eventNumMatch ? parseInt(eventNumMatch[1]) : null,
    date: dateMatch ? dateMatch[1] : null,
    finishers,
    results
  };
}

async function initDatabase(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      event_number INTEGER NOT NULL,
      event_date TEXT NOT NULL,
      finishers INTEGER DEFAULT 0,
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(course_id, event_number)
    );

    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      time TEXT,
      time_seconds INTEGER DEFAULT 0,
      age_category TEXT,
      age_grade REAL,
      gender TEXT,
      club TEXT,
      total_runs INTEGER DEFAULT 0,
      volunteer_count INTEGER DEFAULT 0,
      achievement TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id),
      UNIQUE(event_id, position)
    );

    CREATE INDEX IF NOT EXISTS idx_events_course_date ON events(course_id, event_date);
    CREATE INDEX IF NOT EXISTS idx_results_event_id ON results(event_id);
    CREATE INDEX IF NOT EXISTS idx_results_name ON results(name);
  `);
}

async function main() {
  console.log('🚀 Starting parkrun raw data import...');
  
  // Open database
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
  
  await initDatabase(db);
  
  // Recursively get all HTML files from course subdirectories
  async function getAllHtmlFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return getAllHtmlFiles(fullPath);
      } else if (entry.name.endsWith('.html')) {
        return [fullPath];
      }
      return [];
    }));
    return Array.prototype.concat(...files);
  }

  const htmlFiles = await getAllHtmlFiles(RAWDATA_DIR);
  
  console.log(`📁 Found ${htmlFiles.length} HTML files to process`);
  
  let imported = 0;
  let skipped = 0;
  
  for (const fullFilePath of htmlFiles) {
    const filename = path.basename(fullFilePath);
    const fileInfo = parseFilename(filename);
    if (!fileInfo) {
      console.log(`⚠️  Skipping invalid filename: ${filename}`);
      skipped++;
      continue;
    }
    
    // Check if already imported
    const existing = await db.get(
      'SELECT id FROM events WHERE course_id = ? AND event_number = ?',
      fileInfo.courseId, fileInfo.eventNumber
    );
    
    if (existing) {
      console.log(`⏭️  Already imported: ${filename}`);
      skipped++;
      continue;
    }
    
    console.log(`🔍 Processing: ${filename}`);
    
    try {
      const filePath = fullFilePath;
      const htmlContent = await fs.readFile(filePath, 'utf8');
      const parsed = await parseResultsHtml(htmlContent);
      
      // Insert event
      const eventResult = await db.run(
        `INSERT INTO events (course_id, event_number, event_date, finishers)
         VALUES (?, ?, ?, ?)`,
        fileInfo.courseId,
        fileInfo.eventNumber,
        fileInfo.date,
        parsed.finishers
      );
      
      const eventId = eventResult.lastID;
      
      // Insert all results
      await db.run('BEGIN TRANSACTION');
      
      for (const result of parsed.results) {
        await db.run(
          `INSERT INTO results (
            event_id, position, name, time, time_seconds, 
            age_category, age_grade, gender, club,
            total_runs, volunteer_count, achievement
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          eventId,
          result.position,
          result.name,
          result.time,
          result.timeSeconds,
          result.ageCategory,
          result.ageGrade,
          result.gender,
          result.club,
          result.totalRuns,
          result.volunteerCount,
          result.achievement
        );
      }
      
      await db.run('COMMIT');
      
      console.log(`✅ Imported ${parsed.results.length} results for ${fileInfo.courseId} #${fileInfo.eventNumber}`);
      imported++;
      
    } catch (error) {
      console.error(`❌ Failed to import ${filename}:`, error.message);
      await db.run('ROLLBACK');
    }
  }
  
  await db.close();
  
  console.log('\n✅ Import complete!');
  console.log(`📊 Summary: ${imported} imported, ${skipped} skipped`);
  console.log(`💾 Database saved to: ${DB_PATH}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});