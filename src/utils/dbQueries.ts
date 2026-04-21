import { Database } from 'sql.js';
import { ParkrunLocation } from '../types';

/**
 * Get list of all parkrun courses with base metadata
 */
export function getAllCourses(db: Database): ParkrunLocation[] {
  const stmt = db.prepare(`
    SELECT 
      id, 
      name, 
      url, 
      country, 
      region, 
      elevation, 
      terrain, 
      courseDescription,
      difficultyFactor,
      latitude,
      longitude,
      lastUpdated
    FROM courses
    ORDER BY country, region, name
  `);

  const courses: ParkrunLocation[] = [];
  
  while (stmt.step()) {
    const row = stmt.getAsObject();
    courses.push({
      id: row.id as string,
      name: row.name as string,
      url: row.url as string,
      country: row.country as string,
      region: row.region as string,
      elevation: row.elevation as number,
      terrain: row.terrain as string,
      courseDescription: row.courseDescription as string,
      difficultyFactor: row.difficultyFactor as number,
      latitude: row.latitude as number,
      longitude: row.longitude as number,
      lastUpdated: row.lastUpdated as string,
      totalEvents: 0,
      totalRunners: 0,
      monthlyStats: {}
    } as ParkrunLocation);
  }

  stmt.free();
  return courses;
}

/**
 * Calculate percentiles for a given set of numbers
 */
export function calculatePercentiles(values: number[]) {
  if (!values || values.length === 0) return null;
  
  const valid = values.filter(t => t > 0);
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

/**
 * Get all results for a specific course
 */
export function getCourseResults(db: Database, courseId: string) {
  const stmt = db.prepare(`
    SELECT 
      r.time_seconds, 
      r.age_grade, 
      r.age_category, 
      r.gender,
      strftime('%m', e.event_date) as month
    FROM results r
    JOIN events e ON r.event_id = e.id
    WHERE e.course_id = ?
    ORDER BY r.time_seconds
  `);

  stmt.bind([courseId]);
  
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }

  stmt.free();
  return results;
}