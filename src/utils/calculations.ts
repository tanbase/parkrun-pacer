import { ParkrunLocation, CalculationResult } from '../types';

/**
 * Convert time string in HH:MM:SS format to total seconds
 */
export function timeToSeconds(time: string): number {
  const parts = time.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/**
 * Convert total seconds to time string HH:MM:SS
 */
export function secondsToTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format time difference as string with sign
 */
export function formatTimeDifference(seconds: number): string {
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  
  const sign = seconds > 0 ? '+' : '-';
  
  if (m > 0) {
    return `${sign}${m}m ${s}s`;
  }
  return `${sign}${s}s`;
}

/**
 * Calculate percentile position of a time within a course distribution
 */
export function calculatePercentile(time: number, course: ParkrunLocation, month: number = new Date().getMonth() + 1, category: string = 'All'): number {
  // Handle courses with no stats data available
  const stats = course.monthlyStats[month] || course.monthlyStats[1] || {
    fastestTime: 1200,
    p10: 1300,
    p50: 1500,
    p90: 1800,
    ageGender: {}
  };
  
  // Use category specific stats if available
  if (category !== 'All' && stats.ageGender && stats.ageGender[category as keyof typeof stats.ageGender]) {
    const catStats = stats.ageGender[category as keyof typeof stats.ageGender];
    
    if (time <= catStats.fastest) return 99;
    if (time >= catStats.p90) return 1;
    
    if (time <= catStats.p10) {
      return 90 + 9 * (catStats.p10 - time) / (catStats.p10 - catStats.fastest);
    } else if (time <= catStats.p50) {
      return 50 + 40 * (catStats.p50 - time) / (catStats.p50 - catStats.p10);
    } else {
      return 10 + 40 * (catStats.p90 - time) / (catStats.p90 - catStats.p50);
    }
  }
  
  // Overall course distribution
  if (time <= stats.fastestTime) return 99;
  if (time >= stats.p90) return 1;
  
  if (time <= stats.p10) {
    return 90 + 9 * (stats.p10 - time) / (stats.p10 - stats.fastestTime);
  } else if (time <= stats.p50) {
    return 50 + 40 * (stats.p50 - time) / (stats.p50 - stats.p10);
  } else {
    return 10 + 40 * (stats.p90 - time) / (stats.p90 - stats.p50);
  }
}

/**
 * Find time at a given percentile for a course
 */
export function getTimeAtPercentile(percentile: number, course: ParkrunLocation, month: number = new Date().getMonth() + 1, category: string = 'All'): number {
  // Handle courses with no stats data available
  const stats = course.monthlyStats[month] || course.monthlyStats[1] || {
    fastestTime: 1200,
    p10: 1300,
    p50: 1500,
    p90: 1800,
    ageGender: {}
  };
  
  // Use category specific stats if available
  if (category !== 'All' && stats.ageGender && stats.ageGender[category as keyof typeof stats.ageGender]) {
    const catStats = stats.ageGender[category as keyof typeof stats.ageGender];
    
    if (percentile >= 90) {
      return catStats.fastest + (catStats.p10 - catStats.fastest) * (99 - percentile) / 9;
    } else if (percentile >= 50) {
      return catStats.p10 + (catStats.p50 - catStats.p10) * (90 - percentile) / 40;
    } else if (percentile >= 10) {
      return catStats.p50 + (catStats.p90 - catStats.p50) * (50 - percentile) / 40;
    } else {
      return catStats.p90 + (catStats.p90 * 1.1 - catStats.p90) * (10 - percentile) / 9;
    }
  }
  
  // Overall course distribution
  if (percentile >= 90) {
    return stats.fastestTime + (stats.p10 - stats.fastestTime) * (99 - percentile) / 9;
  } else if (percentile >= 50) {
    return stats.p10 + (stats.p50 - stats.p10) * (90 - percentile) / 40;
  } else if (percentile >= 10) {
    return stats.p50 + (stats.p90 - stats.p50) * (50 - percentile) / 40;
  } else {
    return stats.p90 + (stats.p90 * 1.1 - stats.p90) * (10 - percentile) / 9;
  }
}

/**
 * Calculate equivalent time for all parkruns
 */
export function calculateEquivalentTimes(
  sourceParkrun: ParkrunLocation,
  sourceTime: number,
  allParkruns: ParkrunLocation[],
  month: number = new Date().getMonth() + 1,
  category: string = 'All',
  useAgeGrade: boolean = true
): CalculationResult[] {
  if (useAgeGrade) {
    // ✅ Age Grade mode: use universal performance percentile
    // Difficulty is already normalised in the course difficulty factor
    return allParkruns.map(target => {
      const ratio = target.difficultyFactor / sourceParkrun.difficultyFactor;
      const estimatedTime = target.id === sourceParkrun.id 
        ? sourceTime 
        : Math.round(sourceTime * ratio);
        
      const timeDifference = estimatedTime - sourceTime;
      const percentageDifference = ((estimatedTime / sourceTime) - 1) * 100;
      
      return {
        parkrun: target,
        estimatedTime,
        timeDifference,
        percentageDifference
      };
    }).sort((a, b) => (a.parkrun.difficultyFactor || 1.0) - (b.parkrun.difficultyFactor || 1.0));
    
  } else {
    // ❌ Legacy Finishing Time mode: original raw percentile matching
    const percentile = calculatePercentile(sourceTime, sourceParkrun, month, category);
    
    return allParkruns.map(target => {
      const estimatedTime = target.id === sourceParkrun.id 
        ? sourceTime 
        : getTimeAtPercentile(percentile, target, month, category);
        
      const timeDifference = estimatedTime - sourceTime;
      const percentageDifference = ((estimatedTime / sourceTime) - 1) * 100;
      
      return {
        parkrun: target,
        estimatedTime,
        timeDifference,
        percentageDifference
      };
    }).sort((a, b) => (a.parkrun.difficultyFactor || 1.0) - (b.parkrun.difficultyFactor || 1.0));
  }
}
