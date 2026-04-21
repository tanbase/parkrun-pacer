export interface AgeGenderStats {
  count: number;
  average: number;
  median: number;
  fastest: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface MonthlyStats {
  events: number;
  finishers: number;
  averageTime: number;
  medianTime: number;
  fastestTime: number;
  p10: number;
  p50: number;
  p90: number;
  ageGender: {
    JM: AgeGenderStats;
    JW: AgeGenderStats;
    SM: AgeGenderStats;
    SW: AgeGenderStats;
    VM35: AgeGenderStats;
    VW35: AgeGenderStats;
    VM40: AgeGenderStats;
    VW40: AgeGenderStats;
    VM45: AgeGenderStats;
    VW45: AgeGenderStats;
    VM50: AgeGenderStats;
    VW50: AgeGenderStats;
  };
}

export interface ParkrunLocation {
  id: string;
  name: string;
  url: string;
  country: string;
  region: string;
  lat?: number;
  lon?: number;
  elevation: number;
  terrain: 'road' | 'tarmac' | 'trail' | 'grass' | 'gravel' | 'mixed';
  courseDescription: string;
  totalEvents: number;
  totalRunners: number;
  difficultyFactor: number;
  monthlyStats: {
    [key: number]: MonthlyStats;
  };
  lastUpdated: string;
}

export interface CalculationResult {
  parkrun: ParkrunLocation;
  estimatedTime: number;
  timeDifference: number;
  percentageDifference: number;
}