import courses from '../data/courses.json';

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}

/**
 * Get nearest parkrun courses sorted by distance from given coordinates
 */
export function getNearestCourses(latitude: number, longitude: number, limit: number = 5) {
  return courses
    .filter(course => course.latitude && course.longitude)
    .map(course => ({
      ...course,
      distance: calculateDistance(latitude, longitude, course.latitude, course.longitude)
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/**
 * Get closest single parkrun course
 */
export function getClosestCourse(latitude: number, longitude: number) {
  const nearest = getNearestCourses(latitude, longitude, 1);
  return nearest.length > 0 ? nearest[0] : null;
}