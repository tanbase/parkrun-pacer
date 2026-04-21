/**
 * WAVA 2023 Age Grade Calculator for parkrun (5km)
 * Based on official World Masters Athletics tables
 * 
 * Age grade % = (World Record Time / Your Time) * 100
 * 
 * 100% = World Record
 * 90%+ = World Class
 * 80%+ = National Class
 * 70%+ = Regional Class
 * 60%+ = Local Class
 * <60% = Untrained
 */

// 5km Open World Records as at 2023
const MALE_OPEN_STANDARD = 764;   // 12:44 (Berihu Aregawi)
const FEMALE_OPEN_STANDARD = 858; // 14:18 (Senbere Teferi)

// Age adjustment factors (2023 WAVA standards for road 5km)
const MALE_AGE_FACTORS: Record<number, number> = {
  10: 1.520, 11: 1.445, 12: 1.378, 13: 1.318, 14: 1.263, 15: 1.210, 16: 1.160, 17: 1.112, 18: 1.072, 19: 1.038,
  20: 1.017, 21: 1.005, 22: 1.000, 23: 1.000, 24: 1.000, 25: 1.000, 26: 1.000, 27: 1.000, 28: 1.000, 29: 1.000,
  30: 1.002, 31: 1.006, 32: 1.011, 33: 1.016, 34: 1.022, 35: 1.029, 36: 1.037, 37: 1.046, 38: 1.056, 39: 1.067,
  40: 1.079, 41: 1.092, 42: 1.106, 43: 1.121, 44: 1.137, 45: 1.154, 46: 1.172, 47: 1.191, 48: 1.211, 49: 1.232,
  50: 1.254, 51: 1.277, 52: 1.301, 53: 1.326, 54: 1.352, 55: 1.379, 56: 1.407, 57: 1.436, 58: 1.466, 59: 1.497,
  60: 1.529, 61: 1.562, 62: 1.596, 63: 1.631, 64: 1.667, 65: 1.704, 66: 1.742, 67: 1.781, 68: 1.821, 69: 1.862,
  70: 1.904, 71: 1.947, 72: 1.991, 73: 2.036, 74: 2.082, 75: 2.129, 76: 2.177, 77: 2.226, 78: 2.276, 79: 2.327,
  80: 2.379, 81: 2.432, 82: 2.486, 83: 2.541, 84: 2.597, 85: 2.654, 86: 2.712, 87: 2.771, 88: 2.831, 89: 2.892,
  90: 2.954, 91: 3.017, 92: 3.081, 93: 3.146, 94: 3.212, 95: 3.279, 96: 3.347, 97: 3.416, 98: 3.486, 99: 3.557, 100: 3.629
};

const FEMALE_AGE_FACTORS: Record<number, number> = {
  10: 1.480, 11: 1.410, 12: 1.345, 13: 1.285, 14: 1.230, 15: 1.180, 16: 1.132, 17: 1.087, 18: 1.050, 19: 1.022,
  20: 1.005, 21: 1.000, 22: 1.000, 23: 1.000, 24: 1.000, 25: 1.000, 26: 1.000, 27: 1.000, 28: 1.000, 29: 1.000,
  30: 1.003, 31: 1.008, 32: 1.014, 33: 1.020, 34: 1.027, 35: 1.035, 36: 1.044, 37: 1.054, 38: 1.065, 39: 1.077,
  40: 1.090, 41: 1.104, 42: 1.119, 43: 1.135, 44: 1.152, 45: 1.170, 46: 1.189, 47: 1.209, 48: 1.230, 49: 1.252,
  50: 1.275, 51: 1.299, 52: 1.324, 53: 1.350, 54: 1.377, 55: 1.405, 56: 1.434, 57: 1.464, 58: 1.495, 59: 1.527,
  60: 1.560, 61: 1.594, 62: 1.629, 63: 1.665, 64: 1.702, 65: 1.740, 66: 1.779, 67: 1.819, 68: 1.860, 69: 1.902,
  70: 1.945, 71: 1.989, 72: 2.034, 73: 2.080, 74: 2.127, 75: 2.175, 76: 2.224, 77: 2.274, 78: 2.325, 79: 2.377,
  80: 2.430, 81: 2.484, 82: 2.539, 83: 2.595, 84: 2.652, 85: 2.710, 86: 2.769, 87: 2.829, 88: 2.890, 89: 2.952,
  90: 3.015, 91: 3.079, 92: 3.144, 93: 3.210, 94: 3.277, 95: 3.345, 96: 3.414, 97: 3.484, 98: 3.555, 99: 3.627, 100: 3.700
};

/**
 * Calculate age grade percentage for a 5km run
 * @param timeSeconds Finish time in seconds
 * @param age Age on day of run
 * @param gender 'M' for male, 'F' for female
 */
export function calculateAgeGrade(timeSeconds: number, age: number, gender: 'M' | 'F'): number {
  // Clamp age to valid range
  const clampedAge = Math.max(10, Math.min(100, Math.round(age)));
  
  // Get age factor
  const factors = gender === 'M' ? MALE_AGE_FACTORS : FEMALE_AGE_FACTORS;
  const ageFactor = factors[clampedAge];
  
  if (!ageFactor) {
    return 0;
  }
  
  // Get standard time for this age
  const openStandard = gender === 'M' ? MALE_OPEN_STANDARD : FEMALE_OPEN_STANDARD;
  const ageStandard = openStandard * ageFactor;
  
  // Calculate age grade percentage
  const ageGrade = (ageStandard / timeSeconds) * 100;
  
  // Clamp to reasonable range
  return Math.min(105, Math.max(0, ageGrade));
}

/**
 * Calculate what time is required for a given age grade percentage
 * @param ageGradePercent Target age grade percentage
 * @param age Age of runner
 * @param gender 'M' for male, 'F' for female
 */
export function getTimeForAgeGrade(ageGradePercent: number, age: number, gender: 'M' | 'F'): number {
  // Clamp age to valid range
  const clampedAge = Math.max(10, Math.min(100, Math.round(age)));
  
  // Get age factor
  const factors = gender === 'M' ? MALE_AGE_FACTORS : FEMALE_AGE_FACTORS;
  const ageFactor = factors[clampedAge];
  
  if (!ageFactor) {
    return 0;
  }
  
  // Get standard time for this age
  const openStandard = gender === 'M' ? MALE_OPEN_STANDARD : FEMALE_OPEN_STANDARD;
  const ageStandard = openStandard * ageFactor;
  
  // Calculate required time
  return ageStandard / (ageGradePercent / 100);
}

/**
 * Get human readable age grade classification
 */
export function getAgeGradeClassification(ageGrade: number): string {
  if (ageGrade >= 90) return 'World Class';
  if (ageGrade >= 80) return 'National Class';
  if (ageGrade >= 70) return 'Regional Class';
  if (ageGrade >= 60) return 'Local Class';
  return 'Untrained';
}