import puppeteer from 'puppeteer';
import fs from 'fs-extra';
import path from 'path';

const BASE = "https://www.parkrun.com.au";
const COURSES_FILE = new URL('../src/data/courses.json', import.meta.url).pathname;
const EVENTS_FILE = new URL('../src/data/rawdata/events.json', import.meta.url).pathname;
const OUTPUT_DIR = new URL('../src/data/rawdata', import.meta.url).pathname;
const MAX_PAGES_PER_RUN = 10;
const RESULTS_TO_FETCH = 55;
const SLEEP_BETWEEN_CYCLES = 600000; // 10 minutes in ms

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Read command line arguments: [course] or region:[region]
function getTargetInput() {
  const arg = process.argv[2];
  if (!arg) return { mode: 'all' };
  if (arg.startsWith('region:')) return { mode: 'region', value: arg.split(':')[1] };
  return { mode: 'course', value: arg };
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function getExistingFiles() {
  const allFiles = new Set();
  
  // Recursively scan all course subdirectories
  const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const courseDir = path.join(OUTPUT_DIR, entry.name);
      const courseFiles = await fs.readdir(courseDir);
      courseFiles.filter(f => f.endsWith('.html')).forEach(f => allFiles.add(f));
    } else if (entry.name.endsWith('.html')) {
      allFiles.add(entry.name);
    }
  }
  
  return allFiles;
}

async function run() {
  console.log('🚀 Starting Chrome Parkrun Crawler');
  console.log('==================================\n');

  await fs.ensureDir(OUTPUT_DIR);

  const target = getTargetInput();
  console.log(`🎯 Run Mode: ${target.mode} ${target.value ? '-> ' + target.value : ''}`);

  // Load all courses
  const allCourses = await fs.readJson(COURSES_FILE);
  let courses = allCourses.filter(c => c.country === "Australia");

  // Filter courses based on input
  if (target.mode === 'course') {
    courses = courses.filter(c => c.id === target.value);
    if (courses.length === 0) {
      console.log(`❌ Course '${target.value}' not found`);
      process.exit(1);
    }
  } else if (target.mode === 'region') {
    courses = courses.filter(c => c.region?.toLowerCase() === target.value.toLowerCase());
    if (courses.length === 0) {
      console.log(`❌ No courses found for region '${target.value}'`);
      process.exit(1);
    }
  }

  // Always shuffle courses to randomize order (mimic human behaviour)
  courses = shuffleArray(courses);
  console.log(`📋 ${courses.length} courses available after filtering\n`);

  // Get already downloaded files
  const existingFiles = await getExistingFiles();
  console.log(`💾 Found ${existingFiles.size} existing downloaded pages\n`);

  // Launch Chrome with PERSISTENT USER PROFILE - not stateless
  const userDataDir = path.join(process.cwd(), '.chrome-profile');
  await fs.ensureDir(userDataDir);

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    skipBrowserDownload: true,
    userDataDir: userDataDir,
    defaultViewport: null,
    slowMo: 600,
    protocolTimeout: 180000,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-restore-session-state'
    ]
  });

  // Persist browser context across entire run - don't create incognito page
  const context = browser.defaultBrowserContext();
  const page = await context.newPage();

  // Enable all storage persistence
  await page.setCacheEnabled(true);

  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('✅ Chrome browser ready');

  // Graceful shutdown handler
  let running = true;
  process.on('SIGINT', async () => {
    console.log('\n\n⏹️  Received shutdown signal');
    running = false;
    await browser.close();
    console.log('✅ Crawler stopped gracefully. Chrome closed.');
    process.exit(0);
  });

  // Continuous running loop
  let totalPagesScraped = 0;
  let cycleNumber = 1;

  while (running) {
    console.log(`\n\n🔄 Starting cycle #${cycleNumber}`);
    console.log('========================');

    // Pick one random course from available list
    const randomCourse = courses[Math.floor(Math.random() * courses.length)];
    let cyclePagesScraped = 0;

    console.log(`\n====================================`);
    console.log(`📍 Processing: ${randomCourse.id}`);
    console.log(`====================================`);

    // Refresh existing files before each cycle
    const existingFiles = await getExistingFiles();

    try {
      // Step 0: Download course page if not present
      const courseDir = path.join(OUTPUT_DIR, randomCourse.id);
      await fs.ensureDir(courseDir);
      const coursePagePath = path.join(courseDir, `${randomCourse.id}.html`);
      
      if (!await fs.pathExists(coursePagePath)) {
        console.log(`\n🌐 Downloading course page: ${randomCourse.url}/course/`);
        await page.goto(`${randomCourse.url}/course/`, { waitUntil: 'load', timeout: 180000 });
        await sleep(5000);
        
        // Handle cookies
        try {
          const acceptCookieBtn = await page.$('#onetrust-accept-btn-handler');
          if (acceptCookieBtn) {
            console.log('🍪 Clicking accept cookies');
            await acceptCookieBtn.click();
            await sleep(2500);
          }
        } catch(e) {}
        
        const courseHtml = await page.content();
        await fs.writeFile(coursePagePath, courseHtml, 'utf8');
        console.log(`✅ Saved course page: ${randomCourse.id}.html`);
        
        // Extract coordinates from course page
        const coordinates = await page.evaluate(() => {
          const mapElement = document.querySelector('iframe[src*="google.com/maps"]');
          if (mapElement) {
            const src = mapElement.getAttribute('src');
            const coordMatch = src.match(/q=([\-0-9.]+),([\-0-9.]+)/);
            if (coordMatch) {
              return {
                latitude: parseFloat(coordMatch[1]),
                longitude: parseFloat(coordMatch[2])
              };
            }
          }
          return null;
        });
        
        if (coordinates) {
          // Update course in courses.json
          const courseIndex = allCourses.findIndex(c => c.id === randomCourse.id);
          if (courseIndex !== -1) {
            allCourses[courseIndex].coordinates = coordinates;
            await fs.writeJson(COURSES_FILE, allCourses, { spaces: 2 });
            console.log(`✅ Updated coordinates: ${coordinates.latitude}, ${coordinates.longitude}`);
          }
        } else {
          // Fallback: try to get coordinates from events.json
          try {
            if (await fs.pathExists(EVENTS_FILE)) {
              const events = await fs.readJson(EVENTS_FILE);
              if (events[randomCourse.id]?.coordinates) {
                const courseIndex = allCourses.findIndex(c => c.id === randomCourse.id);
                if (courseIndex !== -1) {
                  allCourses[courseIndex].coordinates = events[randomCourse.id].coordinates;
                  await fs.writeJson(COURSES_FILE, allCourses, { spaces: 2 });
                  console.log(`✅ Updated coordinates from events.json: ${events[randomCourse.id].coordinates.latitude}, ${events[randomCourse.id].coordinates.longitude}`);
                }
              }
            }
          } catch(e) {
            console.log(`⚠️  Could not load coordinates from events.json:`, e.message);
          }
        }
        
        await sleep(3000);
      } else {
        console.log(`⏭️  Course page already exists: ${randomCourse.id}.html`);
      }

      // Step 1: Go to latest results to find current event number
      const latestUrl = `${randomCourse.url}/results/latestresults/`;
      console.log(`\n🌐 Loading latest results page`);

      await page.goto(latestUrl, { waitUntil: 'load', timeout: 180000 });
      await sleep(5000);

      // Handle cookies
      try {
        const acceptCookieBtn = await page.$('#onetrust-accept-btn-handler');
        if (acceptCookieBtn) {
          console.log('🍪 Clicking accept cookies');
          await acceptCookieBtn.click();
          await sleep(2500);
        }
      } catch(e) {}

      await sleep(8000);

      // Extract latest event number
      const latestEvent = await page.evaluate(() => {
        const eventElement = document.querySelector('.Results-header h3 span:last-of-type');
        if (eventElement) {
          const eventMatch = eventElement.textContent.match(/#(\d+)/);
          if (eventMatch) return parseInt(eventMatch[1], 10);
        }
        return 0;
      });

      if (latestEvent === 0) {
        console.log('❌ Could not find latest event number, skipping');
        await sleep(4000);
        continue;
      }

      console.log(`📅 Latest event: #${latestEvent}`);

      // Find lowest existing event number for this course
      const courseFiles = await fs.readdir(path.join(OUTPUT_DIR, randomCourse.id));
      const existingEventNums = courseFiles
        .filter(f => f.endsWith('.html') && f.startsWith(`${randomCourse.id}-`))
        .map(f => {
          const match = f.match(/^\w+-(\d+)-/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => n > 0);
      
      const lowestExisting = existingEventNums.length > 0 ? Math.min(...existingEventNums) : latestEvent;
      const remainingEvents = lowestExisting - 1;

      // Step 2: Work backwards from latest event up to max pages per cycle
      let lastEventDate = '';

      for (let i = 0; i < RESULTS_TO_FETCH && cyclePagesScraped < MAX_PAGES_PER_RUN; i++) {
        if (!running) break;

        const eventNum = latestEvent - i;
        if (eventNum <= 0) break;

        // Check if we already have this file
        const filePrefix = `${randomCourse.id}-${eventNum}-`;
        const alreadyHave = Array.from(existingFiles).some(f => f.startsWith(filePrefix));

        if (alreadyHave) {
          console.log(`⏭️  Event #${eventNum} already exists, skipping`);
          continue;
        }

        // Load this event page
        const eventUrl = `${randomCourse.url}/results/${eventNum}/`;
        console.log(`\n🌐 Fetching event #${eventNum}: ${eventUrl}`);

        await page.goto(eventUrl, { waitUntil: 'load', timeout: 180000 });
        await sleep(12000); // Extra long wait for slow loading

        // Extract date
        const pageData = await page.evaluate(() => {
          let dateStr = '';
          const dateElement = document.querySelector('.Results-header h3 span.format-date');
          if (dateElement) {
            const dateText = dateElement.textContent.trim();

            // ✅ UNIVERSAL DATE PARSER - handles ALL formats:
            // yyyy-mm-dd | dd/mm/yyyy | dd/mm/yy | d/m/yy | d/m/yyyy | mm/dd/yy
            
            let day, month, year;

            // Format 1: ISO format YYYY-MM-DD
            let m = dateText.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (m) {
              year = m[1];
              month = m[2].padStart(2, '0');
              day = m[3].padStart(2, '0');
            } else {
              // Format 2: All slash formats (dd/mm/yy, d/m/yyyy, etc)
              m = dateText.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
              if (m) {
                day = m[1].padStart(2, '0');
                month = m[2].padStart(2, '0');
                year = m[3];
                
                // 2 digit year conversion, safe for years after 2000
                if (year.length === 2) {
                  year = parseInt(year) > 60 ? `19${year}` : `20${year}`;
                }
              }
            }

            if (day && month && year) {
              dateStr = `${year}${month}${day}`;
            }
          }
          return { dateStr, fullHtml: document.documentElement.outerHTML };
        });

        // Save file into course specific subdirectory
        const courseDir = path.join(OUTPUT_DIR, randomCourse.id);
        await fs.ensureDir(courseDir);
        
        const filename = `${randomCourse.id}-${eventNum}-${pageData.dateStr}.html`;
        const savePath = path.join(courseDir, filename);
        await fs.writeFile(savePath, pageData.fullHtml, 'utf8');

        existingFiles.add(filename);
        cyclePagesScraped++;
        totalPagesScraped++;
        
        if (i === 0) lastEventDate = pageData.dateStr;

        console.log(`✅ Saved: ${filename} | ${cyclePagesScraped}/${MAX_PAGES_PER_RUN}`);

        // Polite delay between pages
        await sleep(7000 + Math.random() * 5000);
      }

      console.log(`✅ ${randomCourse.id} completed | Scraped ${cyclePagesScraped} pages`);

      // Print summary table
      console.log(`\n\n📊 Cycle #${cycleNumber} Summary`);
      console.log('============================');
      console.table([{
        'Course': randomCourse.id,
        'Last': lastEventDate || 'N/A',
        'Last#': latestEvent,
        'Scraped': existingEventNums.length,
        'Remaining': `${remainingEvents} / ${RESULTS_TO_FETCH}`
      }]);
      console.log(`\n📈 Total pages scraped this session: ${totalPagesScraped}`);

    } catch (err) {
      console.log(`❌ Failed processing ${randomCourse.id}:`, err.message);
      await sleep(15000);
    }

    // Sleep before next cycle
    cycleNumber++;
    if (!running) break;

    console.log(`\n😴 Sleeping for 10 minutes before next cycle... (Ctrl+C to stop)`);
    await sleep(SLEEP_BETWEEN_CYCLES);
  }

  await browser.close();
  console.log(`\n✅ Crawl completed! Scraped ${totalPagesScraped} pages total. Chrome closed.`);
}

run().catch(err => {
  console.error('\n❌ Fatal crawler error:', err);
  process.exit(1);
});