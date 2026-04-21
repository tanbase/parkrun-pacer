/**
 * Parkrun Results Analyser
 * Reads raw results from SQLite repository and generates summarised JSON for Parkrun Pacer frontend
 * Runs all statistical calculations and generates optimised application data
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs/promises';

const CATEGORIES = [
  'JM10', 'JW10',
  'JM11-14', 'JW11-14',
  'JM15-17', 'JW15-17',
  'SM18-19', 'SW18-19',
  'SM20-24', 'SW20-24',
  'SM25-29', 'SW25-29',
  'SM30-34', 'SW30-34',
  'VM35-39', 'VW35-39',
  'VM40-44', 'VW40-44',
  'VM45-49', 'VW45-49',
  'VM50-54', 'VW50-54',
  'VM55-59', 'VW55-59',
  'VM60-64', 'VW60-64',
  'VM65-69', 'VW65-69',
  'VM70-74', 'VW70-74',
  'VM75+', 'VW75+'
];

async function initDatabase() {
  const dbPath = path.join(process.cwd(), 'src', 'data', 'parkrun.db');
  
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  
  return db;
}

function calculatePercentiles(sortedArray) {
  if (!sortedArray || sortedArray.length === 0) return null;
  
  // Filter out 0 values (DNS/DNF) and ensure proper numerical sort
  const valid = sortedArray.filter(t => t > 0);
  if (valid.length === 0) return null;
  
  const sorted = [...valid].sort((a, b) => a - b);
  
  return {
    count: sorted.length,
    average: Math.round(sorted.reduce((a,b) => a + b, 0) / sorted.length),
    median: sorted[Math.floor(sorted.length * 0.5)],
    fastest: sorted[0],
    p10: sorted[Math.floor(sorted.length * 0.10)],
    p50: sorted[Math.floor(sorted.length * 0.50)],
    p90: sorted[Math.floor(sorted.length * 0.90)]
  };
}

async function analyseCourse(db, course, globalMedianAgeGrade) {
  console.log(`Analysing ${course.id}...`);
  
  // Get all times and age grades for this course
  const allTimes = await db.all(`
    SELECT r.time_seconds, r.age_grade, r.age_category, strftime('%m', e.event_date) as month, e.id as event_id
    FROM results r
    JOIN events e ON r.event_id = e.id
    WHERE e.course_id = ?
    ORDER BY r.time_seconds
  `, [course.id]);
  
  const times = allTimes.map(r => r.time_seconds);
  const ageGrades = allTimes.filter(r => r.age_grade > 0).map(r => r.age_grade);
  
  // Calculate difficulty factor using AGE GRADE median (unbiased)
  // Benchmark is actual median age grade across all courses in database
  const medianAgeGrade = ageGrades.length > 0 
    ? [...ageGrades].sort((a,b) => a - b)[Math.floor(ageGrades.length * 0.5)] 
    : null;
  
  // Difficulty factor = globalMedianAgeGrade / median age grade
  // >1.0 = harder than average
  // <1.0 = easier than average
  // 1.0 = exactly average difficulty
  const difficultyFactor = medianAgeGrade ? parseFloat((globalMedianAgeGrade / medianAgeGrade).toFixed(3)) : null;
  
  // Group by month
  const monthlyStats = {};
  
  for (let month = 1; month <= 12; month++) {
    const monthStr = month.toString().padStart(2, '0');
    const monthTimes = allTimes.filter(r => r.month === monthStr).map(r => r.time_seconds).sort((a,b) => a - b);
    
    if (monthTimes.length > 0) {
      const stats = calculatePercentiles(monthTimes);
      
      monthlyStats[month] = {
        events: new Set(allTimes.filter(r => r.month === monthStr).map(r => r.event_id)).size,
        finishers: stats.count,
        averageTime: stats.average,
        medianTime: stats.median,
        fastestTime: stats.fastest,
        p10: stats.p10,
        p50: stats.p50,
        p90: stats.p90,
        ageGender: {}
      };
      
      // Add All category (all runners combined)
      const allAgeGrades = allTimes.filter(r => r.month === monthStr && r.age_grade > 0).map(r => r.age_grade).sort((a,b) => a - b);
      
      monthlyStats[month].ageGender['All'] = {
        count: stats.count,
        average: stats.average,
        median: stats.median,
        fastest: stats.fastest,
        p10: stats.p10,
        p50: stats.p50,
        p90: stats.p90,
        averageAgeGrade: allAgeGrades.length > 0 ? allAgeGrades.reduce((a,b) => a + b, 0) / allAgeGrades.length : 60,
        medianAgeGrade: allAgeGrades.length > 0 ? allAgeGrades[Math.floor(allAgeGrades.length * 0.5)] : 60,
        fastestAgeGrade: allAgeGrades.length > 0 ? allAgeGrades[allAgeGrades.length - 1] : 75,
        p90AgeGrade: allAgeGrades.length > 0 ? allAgeGrades[Math.floor(allAgeGrades.length * 0.9)] : 75
      };
      
       // Calculate per category stats
       for (const cat of CATEGORIES) {
         const catEntries = allTimes
           .filter(r => {
             if (r.month !== monthStr || !r.age_category) return false;
             
             // Exact full match for standard parkrun age categories
             return r.age_category === cat;
           });
         
         if (catEntries.length > 0) {
           const catStats = calculatePercentiles(catEntries.map(r => r.time_seconds));
           
           // Calculate age grade percentiles
           const ageGrades = catEntries.filter(r => r.age_grade > 0).map(r => r.age_grade).sort((a,b) => a - b);
           
           monthlyStats[month].ageGender[cat] = {
             count: catStats.count,
             average: catStats.average,
             median: catStats.median,
             fastest: catStats.fastest,
             p10: catStats.p10,
             p50: catStats.p50,
             p90: catStats.p90,
              averageAgeGrade: ageGrades.length > 0 ? ageGrades.reduce((a,b) => a + b, 0) / ageGrades.length : 60,
              medianAgeGrade: ageGrades.length > 0 ? ageGrades[Math.floor(ageGrades.length * 0.5)] : 60,
              fastestAgeGrade: ageGrades.length > 0 ? ageGrades[ageGrades.length - 1] : 75,
              p90AgeGrade: ageGrades.length > 0 ? ageGrades[Math.floor(ageGrades.length * 0.9)] : 75
           };
         }
      }
    }
  }
  
  // Add global All month entry (all months combined)
  const allMonthStats = calculatePercentiles(allTimes.map(r => r.time_seconds));
  
  if (allMonthStats) {
    monthlyStats[0] = {
      events: new Set(allTimes.map(r => r.event_id)).size,
      finishers: allMonthStats.count,
      averageTime: allMonthStats.average,
      medianTime: allMonthStats.median,
      fastestTime: allMonthStats.fastest,
      p10: allMonthStats.p10,
      p50: allMonthStats.p50,
      p90: allMonthStats.p90,
      ageGender: {}
    };
    
    // Add All category
    const allAgeGradesGlobal = allTimes.filter(r => r.age_grade > 0).map(r => r.age_grade).sort((a,b) => a - b);
    
    monthlyStats[0].ageGender['All'] = {
      count: allMonthStats.count,
      average: allMonthStats.average,
      median: allMonthStats.median,
      fastest: allMonthStats.fastest,
      p10: allMonthStats.p10,
      p50: allMonthStats.p50,
      p90: allMonthStats.p90,
      averageAgeGrade: allAgeGradesGlobal.length > 0 ? allAgeGradesGlobal.reduce((a,b) => a + b, 0) / allAgeGradesGlobal.length : 60,
      medianAgeGrade: allAgeGradesGlobal.length > 0 ? allAgeGradesGlobal[Math.floor(allAgeGradesGlobal.length * 0.5)] : 60,
      fastestAgeGrade: allAgeGradesGlobal.length > 0 ? allAgeGradesGlobal[allAgeGradesGlobal.length - 1] : 75,
      p90AgeGrade: allAgeGradesGlobal.length > 0 ? allAgeGradesGlobal[Math.floor(allAgeGradesGlobal.length * 0.9)] : 75
    };
    
    // Calculate all categories for All month
    for (const cat of CATEGORIES) {
      const catEntries = allTimes
        .filter(r => r.age_category === cat);
      
      if (catEntries.length > 0) {
        const catStats = calculatePercentiles(catEntries.map(r => r.time_seconds));
        
        // Calculate age grade percentiles
        const ageGrades = catEntries.filter(r => r.age_grade > 0).map(r => r.age_grade).sort((a,b) => a - b);
        
        monthlyStats[0].ageGender[cat] = {
          count: catStats.count,
          average: catStats.average,
          median: catStats.median,
          fastest: catStats.fastest,
          p10: catStats.p10,
          p50: catStats.p50,
          p90: catStats.p90,
              averageAgeGrade: ageGrades.length > 0 ? ageGrades.reduce((a,b) => a + b, 0) / ageGrades.length : 60,
              medianAgeGrade: ageGrades.length > 0 ? ageGrades[Math.floor(ageGrades.length * 0.5)] : 60,
              fastestAgeGrade: ageGrades.length > 0 ? ageGrades[ageGrades.length - 1] : 75,
              p90AgeGrade: ageGrades.length > 0 ? ageGrades[Math.floor(ageGrades.length * 0.9)] : 75
        };
      }
    }
  }

  return {
    difficultyFactor,
    totalEvents: allTimes.length > 0 ? new Set(allTimes.map(r => r.event_id)).size : course.totalEvents || 0,
    totalRunners: allTimes.length || course.totalRunners || 0,
    monthlyStats,
    lastUpdated: new Date().toISOString().split('T')[0],
    dataCompleteness: {
      totalResults: allTimes.length,
      monthsWithData: Object.keys(monthlyStats).length
    }
  };
}

async function runAnalysis() {
  console.log('Starting Parkrun Results Analysis...\n');
  
  // Load master course definitions (single source of truth)
  const coursesPath = path.join(process.cwd(), 'src', 'data', 'courses.json');
  const courses = JSON.parse(await fs.readFile(coursesPath, 'utf8'));
  
  const db = await initDatabase();
  const results = [];
  const allMedianAgeGrades = [];
  
  // First pass - collect all median age grades
  for (const course of courses) {
    // Get age grades for this course
    const ageGrades = await db.all(`
      SELECT r.age_grade
      FROM results r
      JOIN events e ON r.event_id = e.id
      WHERE e.course_id = ? AND r.age_grade > 0
    `, [course.id]);
    
    if (ageGrades.length > 0) {
      const sorted = [...ageGrades.map(r => r.age_grade)].sort((a,b) => a - b);
      const median = sorted[Math.floor(sorted.length * 0.5)];
      allMedianAgeGrades.push(median);
    }
  }
  
  // Calculate global average median age grade from database
  const globalMedianAgeGrade = allMedianAgeGrades.length > 0 
    ? allMedianAgeGrades.reduce((a,b) => a + b, 0) / allMedianAgeGrades.length 
    : 60;
  
  console.log(`⚖️  Global median age grade from database: ${globalMedianAgeGrade.toFixed(2)}`);
  
  // Second pass - analyse each course with actual global average
  for (const course of courses) {
    const analysed = await analyseCourse(db, course, globalMedianAgeGrade);
    // Merge statistics back onto original course object
    results.push({ ...course, ...analysed });
  }
  
  await db.close();
  
  // Write back to courses.json as single source of truth
  await fs.writeFile(coursesPath, JSON.stringify(results, null, 2));
  
  console.log(`\n✅ Analysis complete. Calculated statistics for ${results.length} parkruns`);
  console.log(`✅ Updated src/data/courses.json with latest summarised data`);
}

runAnalysis();