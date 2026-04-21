const fs = require('fs');
const path = require('path');

// Load files
const eventsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/rawdata/events.json'), 'utf8'));
const coursesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/courses.json'), 'utf8'));

// Create map from events data
const eventMap = {};
eventsData.events.features.forEach(feature => {
  const eventName = feature.properties.eventname;
  eventMap[eventName] = {
    longitude: feature.geometry.coordinates[0],
    latitude: feature.geometry.coordinates[1],
    location: feature.properties.EventLocation
  };
});

// Update each course
const updatedCourses = coursesData.map(course => {
  const eventData = eventMap[course.id];
  
  const updatedCourse = {
    id: course.id,
    name: course.name,
    url: course.url,
    country: course.country,
    region: course.region,
    elevation: course.elevation,
    terrain: course.terrain,
    averageRunners: Math.round(course.totalRunners / course.totalEvents),
    courseDescription: course.courseDescription,
    totalEvents: course.totalEvents,
    totalRunners: course.totalRunners,
    difficultyFactor: course.difficultyFactor,
    lastUpdated: course.lastUpdated
  };

  if (eventData) {
    updatedCourse.longitude = eventData.longitude;
    updatedCourse.latitude = eventData.latitude;
    updatedCourse.location = eventData.location;
  }

  // Add monthlyStats and any other existing fields
  Object.keys(course).forEach(key => {
    if (!updatedCourse.hasOwnProperty(key)) {
      updatedCourse[key] = course[key];
    }
  });

  return updatedCourse;
});

// Write back to courses.json
fs.writeFileSync(path.join(__dirname, '../src/data/courses.json'), JSON.stringify(updatedCourses, null, 2), 'utf8');

console.log(`Updated ${updatedCourses.length} courses with GPS data and average runners field`);