import { ParkrunLocation, CalculationResult } from '../types';

/**
 * Convert time string in HH:MM:SS format to total seconds
 */
export function timeToSeconds(time: string): number {
  if (!time || typeof time !== 'string') return 0;
  
  const parts = time.split(':').map(Number);
  
  // Validate all parts are actual numbers
  if (parts.some(isNaN)) return 0;
  
  if (parts.length === 2) {
    return Math.max(0, parts[0] * 60 + parts[1]);
  }
  if (parts.length === 3) {
    return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  
  return 0;
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
  // Input validation
  if (!time || time <= 0 || !course) return 50;
  
  // Normalise month to 1-12 range
  const normalisedMonth = ((month - 1) % 12) + 1;
  
  // Handle courses with no stats data available
  const stats = course.monthlyStats[normalisedMonth] || course.monthlyStats[1] || {
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
    if (time >= catStats.p90) return 10;
    
    if (time <= catStats.p10) {
      const range = catStats.p10 - catStats.fastest;
      return range > 0 ? 90 + 9 * (catStats.p10 - time) / range : 95;
    } else if (time <= catStats.p50) {
      const range = catStats.p50 - catStats.p10;
      return range > 0 ? 50 + 40 * (catStats.p50 - time) / range : 70;
    } else {
      const range = catStats.p90 - catStats.p50;
      return range > 0 ? 10 + 40 * (catStats.p90 - time) / range : 30;
    }
  }
  
  // Overall course distribution
  if (time <= stats.fastestTime) return 99;
  if (time >= stats.p90) return 10;
  
  if (time <= stats.p10) {
    const range = stats.p10 - stats.fastestTime;
    return range > 0 ? 90 + 9 * (stats.p10 - time) / range : 95;
  } else if (time <= stats.p50) {
    const range = stats.p50 - stats.p10;
    return range > 0 ? 50 + 40 * (stats.p50 - time) / range : 70;
  } else {
    const range = stats.p90 - stats.p50;
    return range > 0 ? 10 + 40 * (stats.p90 - time) / range : 30;
  }
}

/**
 * Find time at a given percentile for a course
 */
export function getTimeAtPercentile(percentile: number, course: ParkrunLocation, month: number = new Date().getMonth() + 1, category: string = 'All'): number {
  // Input validation
  if (percentile <= 0 || percentile > 100 || !course) return 1500;
  
  // Normalise month to 1-12 range
  const normalisedMonth = ((month - 1) % 12) + 1;
  
  // Handle courses with no stats data available
  const stats = course.monthlyStats[normalisedMonth] || course.monthlyStats[1] || {
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
      const range = catStats.p10 - catStats.fastest;
      return range > 0 ? catStats.fastest + range * (99 - percentile) / 9 : catStats.fastest;
    } else if (percentile >= 50) {
      const range = catStats.p50 - catStats.p10;
      return range > 0 ? catStats.p10 + range * (90 - percentile) / 40 : catStats.p10;
    } else {
      const range = catStats.p90 - catStats.p50;
      return range > 0 ? catStats.p50 + range * (50 - percentile) / 40 : catStats.p50;
    }
  }
  
  // Overall course distribution
  if (percentile >= 90) {
    const range = stats.p10 - stats.fastestTime;
    return range > 0 ? stats.fastestTime + range * (99 - percentile) / 9 : stats.fastestTime;
  } else if (percentile >= 50) {
    const range = stats.p50 - stats.p10;
    return range > 0 ? stats.p10 + range * (90 - percentile) / 40 : stats.p10;
  } else {
    const range = stats.p90 - stats.p50;
    return range > 0 ? stats.p50 + range * (50 - percentile) / 40 : stats.p50;
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
    // Difficulty factor: <1.0 = harder course, >1.0 = easier course
    // Ratio = target difficulty / source difficulty
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

/**
 * Encode coordinates into Google Maps polyline format
 */
export function encodePolyline(coordinates: [number, number][]): string {
  let encoded = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const [lat, lng] of coordinates) {
    const latValue = Math.round(lat * 1e5);
    const lngValue = Math.round(lng * 1e5);
    
    const dLat = latValue - prevLat;
    const dLng = lngValue - prevLng;
    
    prevLat = latValue;
    prevLng = lngValue;

    const encodeValue = (value: number) => {
      let v = value < 0 ? ~(value << 1) : value << 1;
      let result = '';
      
      while (v >= 0x20) {
        result += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      result += String.fromCharCode(v + 63);
      return result;
    };

    encoded += encodeValue(dLat);
    encoded += encodeValue(dLng);
  }

  return encoded;
}