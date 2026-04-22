import { useState, useEffect } from 'react';
import { ParkrunLocation, CalculationResult } from './types';
import { calculateEquivalentTimes, secondsToTime, formatTimeDifference, timeToSeconds } from './utils/calculations';
import coursesData from './data/courses.json';

export default function App() {
  const [parkruns, setParkruns] = useState<ParkrunLocation[]>([]);
  const [selectedParkrun, setSelectedParkrun] = useState<ParkrunLocation | null>(null);
  const [loading, setLoading] = useState(true);

  // Calculated global medians from actual dataset
  const [globalMedianTime, setGlobalMedianTime] = useState(1680);
  const [globalMedianAgeGrade, setGlobalMedianAgeGrade] = useState(62);

  useEffect(() => {
    // Load courses from static JSON file (not from database)
    const courses = coursesData as ParkrunLocation[];
    setParkruns(courses);

    // Calculate actual global medians from real data
    const allMedianTimes: number[] = [];
    const allMedianAges: number[] = [];

    courses.forEach(course => {
      const stats = course.monthlyStats[0] || course.monthlyStats[1];
      if (stats?.medianTime) allMedianTimes.push(stats.medianTime);
      if (stats?.ageGender?.All?.medianAgeGrade) allMedianAges.push(stats.ageGender.All.medianAgeGrade);
    });

    allMedianTimes.sort((a, b) => a - b);
    allMedianAges.sort((a, b) => a - b);

    const medianTime = allMedianTimes[Math.floor(allMedianTimes.length / 2)] || 1680;
    const medianAge = allMedianAges[Math.floor(allMedianAges.length / 2)] || 62;

    setGlobalMedianTime(medianTime);
    setGlobalMedianAgeGrade(medianAge);

    setLoading(false);
  }, []);

  const [timeInput, setTimeInput] = useState<string>('25:00');
  const [selectedMonth, setSelectedMonth] = useState<number>(0);
  const [results, setResults] = useState<CalculationResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<CalculationResult | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sortBy, setSortBy] = useState<string>('difficulty');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedDetailsMonth, setSelectedDetailsMonth] = useState<number>(new Date().getMonth() + 1);
   const [parkrunDropdownOpen, setParkrunDropdownOpen] = useState<boolean>(false);
   const [monthDropdownOpen, setMonthDropdownOpen] = useState<boolean>(false);
   const [categoryDropdownOpen, setCategoryDropdownOpen] = useState<boolean>(false);
   const [useAgeGrade, setUseAgeGrade] = useState<boolean>(false);
   const [useDetailViewTime, setUseDetailViewTime] = useState<boolean>(!useAgeGrade);

  useEffect(() => {
    setSelectedDetailsMonth(selectedMonth);
  }, [selectedMonth]);

  useEffect(() => {
    setUseDetailViewTime(!useAgeGrade);
  }, [useAgeGrade]);

  // IP based geolocation for closest parkrun
  useEffect(() => {
    if (parkruns.length > 0) {
      // Use free ip-api.com for location lookup without user permission prompt
      fetch('https://ipapi.co/json/')
        .then(res => res.json())
        .then(data => {
          if (data.latitude && data.longitude) {
            const userLat = data.latitude;
            const userLon = data.longitude;
            
            // Find closest parkrun (using haversine formula)
            let closest = parkruns[2];
            let minDistance = Infinity;
            
            for (const parkrun of parkruns) {
              if (parkrun.latitude && parkrun.longitude) {
                const R = 6371; // Earth radius in km
                const dLat = (parkrun.latitude - userLat) * Math.PI / 180;
                const dLon = (parkrun.longitude - userLon) * Math.PI / 180;
                const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                          Math.cos(userLat * Math.PI / 180) * Math.cos(parkrun.latitude * Math.PI / 180) *
                          Math.sin(dLon/2) * Math.sin(dLon/2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                const distance = R * c;
                
                if (distance < minDistance) {
                  minDistance = distance;
                  closest = parkrun;
                }
              }
            }
            
            setSelectedParkrun(closest);
          } else {
            setSelectedParkrun(parkruns[2]);
          }
        })
        .catch(() => {
          // Fallback to average difficulty course
          setSelectedParkrun(parkruns[2]);
        });
    }
  }, [parkruns]);

  useEffect(() => {
    if (selectedParkrun && timeInput) {
      try {
        const time = timeToSeconds(timeInput);
        const calculatedResults = calculateEquivalentTimes(selectedParkrun, time, parkruns, selectedMonth, selectedCategory, useAgeGrade);
        setResults(calculatedResults);
      } catch (e) {
        console.error("Calculation error:", e);
        setResults([]);
      }
    }
  }, [selectedParkrun, timeInput, selectedMonth, selectedCategory, parkruns, useAgeGrade]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading parkrun database...</div>
      </div>
    );
  }

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDirection('asc');
    }
  };

  const getDifficulty = (course: CalculationResult) => {
    if (useAgeGrade) {
      // Age Grade mode: use median age grade
      const courseMedianAge = course.parkrun.monthlyStats[selectedMonth]?.ageGender[selectedCategory]?.medianAgeGrade || course.parkrun.monthlyStats[0]?.ageGender[selectedCategory]?.medianAgeGrade || globalMedianAgeGrade;
      return globalMedianAgeGrade / courseMedianAge;
    } else {
      // Finishing Time mode: use median time
      const courseMedianTime = course.parkrun.monthlyStats[selectedMonth]?.ageGender[selectedCategory]?.median || course.parkrun.monthlyStats[0]?.ageGender[selectedCategory]?.median || course.parkrun.monthlyStats[selectedMonth]?.medianTime || course.parkrun.monthlyStats[0]?.medianTime || globalMedianTime;
      return courseMedianTime / globalMedianTime;
    }
  };

  const getCourseLocation = (course: CalculationResult) => {
    // Handle both lat/lon and latitude/longitude property names
    return {
      latitude: course.parkrun.latitude ?? course.parkrun.lat,
      longitude: course.parkrun.longitude ?? course.parkrun.lon
    };
  };

  const sortResults = (results: CalculationResult[]) => {
    return [...results].sort((a, b) => {
      let aVal, bVal;

      const getDistance = (course) => {
        if (!selectedParkrun?.latitude || !course.parkrun.latitude) return Infinity;
        const R = 6371; // Earth radius in km
        const dLat = (course.parkrun.latitude - selectedParkrun.latitude) * Math.PI / 180;
        const dLon = (course.parkrun.longitude - selectedParkrun.longitude) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(selectedParkrun.latitude * Math.PI / 180) * Math.cos(course.parkrun.latitude * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
      };

      switch(sortBy) {
        case 'name': aVal = a.parkrun.name; bVal = b.parkrun.name; break;
        case 'time': aVal = a.estimatedTime; bVal = b.estimatedTime; break;
        case 'difficulty': aVal = getDifficulty(a); bVal = getDifficulty(b); break;
        case 'elevation': aVal = a.parkrun.elevation; bVal = b.parkrun.elevation; break;
        case 'events': aVal = a.parkrun.totalEvents; bVal = b.parkrun.totalEvents; break;
        case 'runners': aVal = a.parkrun.totalRunners / a.parkrun.totalEvents; bVal = b.parkrun.totalRunners / b.parkrun.totalEvents; break;
        case 'distance': aVal = getDistance(a); bVal = getDistance(b); break;
        default: aVal = getDifficulty(a); bVal = getDifficulty(b);
      }

      if (typeof aVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
      }
      
      return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  };

  const filteredResults = sortResults(results.filter(r => 
    r.parkrun.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
    r.parkrun.region.toLowerCase().includes(searchFilter.toLowerCase())
  ));

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-green-700 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Parkrun Pacer</h1>
              <p className="text-green-200 mt-1">Parkrun course equivalency calculator</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white text-sm">Calculation Mode:</span>
              <div className="flex bg-green-600 rounded-lg p-1">
                <button
                  onClick={() => setUseAgeGrade(false)}
                  className={`px-3 py-1 rounded-md text-sm transition-all ${!useAgeGrade ? 'bg-white text-green-700 font-medium' : 'text-green-100 hover:text-white'}`}
                >
                  Finishing Time
                </button>
                <button
                  onClick={() => setUseAgeGrade(true)}
                  className={`px-3 py-1 rounded-md text-sm transition-all ${useAgeGrade ? 'bg-white text-green-700 font-medium' : 'text-green-100 hover:text-white'}`}
                >
                  Age Grade
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Input Panel */}
      <div className="sticky top-0 z-10 bg-white shadow-md border-b">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <p className="text-gray-600 text-sm mb-2">Enter your time from any parkrun to calculate your expected finishing time at every other course</p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4" style={{ gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1.5fr' }}>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Parkrun</label>
              <div 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 h-10 text-base flex items-center justify-between cursor-pointer hover:border-blue-500"
                onClick={() => setParkrunDropdownOpen(!parkrunDropdownOpen)}
              >
                <span>{selectedParkrun?.name}</span>
                <span className="ml-auto text-gray-400">▼</span>
              </div>
              {parkrunDropdownOpen && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                  {parkruns.map(p => (
                    <div 
                      key={p.id}
                      className={`px-3 py-2 cursor-pointer hover:bg-blue-50 flex justify-between items-center ${selectedParkrun?.id === p.id ? 'bg-blue-50' : ''}`}
                      onClick={() => {
                        setSelectedParkrun(p);
                        setParkrunDropdownOpen(false);
                      }}
                    >
                      <div className="flex flex-col">
                        <span>{p.name}</span>
                        <span className="text-xs text-gray-400">{p.country}</span>
                      </div>
                      <span className="text-gray-500 text-sm">{p.region}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Time</label>
              <input 
                type="text" 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 h-10 text-base font-mono"
                value={timeInput}
                onChange={(e) => {
                  let val = e.target.value.replace(/[^0-9:]/g, '');
                  if (val.length === 2 && !val.includes(':')) {
                    val = val + ':';
                  }
                  if (val.length > 5) {
                    val = val.substring(0, 5);
                  }
                  if (/^\d{2}:\d{2}$/.test(val)) {
                    const mins = parseInt(val.split(':')[0]);
                    const secs = parseInt(val.split(':')[1]);
                    if (mins >= 0 && mins < 60 && secs >= 0 && secs < 60) {
                      setTimeInput(val);
                    }
                  } else {
                    setTimeInput(val);
                  }
                }}
                onBlur={() => {
                  const parts = timeInput.split(':');
                  if (parts.length === 2) {
                    const mins = parts[0].padStart(2, '0');
                    const secs = parts[1].padStart(2, '0');
                    setTimeInput(`${mins}:${secs}`);
                  }
                }}
                placeholder="MM:SS"
                maxLength={5}
              />
            </div>

            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
              <div 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 h-10 text-base flex items-center justify-between cursor-pointer hover:border-blue-500"
                onClick={() => setMonthDropdownOpen(!monthDropdownOpen)}
              >
                <span>{selectedMonth === 0 ? 'All' : months[selectedMonth - 1]}</span>
                <span className="ml-auto text-gray-400">▼</span>
              </div>
              {monthDropdownOpen && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                <div 
                  key="all"
                  className={`px-3 py-2 cursor-pointer hover:bg-blue-50 ${selectedMonth === 0 ? 'bg-blue-50' : ''}`}
                  onClick={() => {
                    setSelectedMonth(0);
                    setMonthDropdownOpen(false);
                  }}
                >
                  All
                </div>
                {months.map((m, i) => (
                  <div 
                    key={i}
                    className={`px-3 py-2 cursor-pointer hover:bg-blue-50 ${selectedMonth === i+1 ? 'bg-blue-50' : ''}`}
                    onClick={() => {
                      setSelectedMonth(i+1);
                      setMonthDropdownOpen(false);
                    }}
                  >
                    {m}
                  </div>
                ))}
                </div>
              )}
            </div>

            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <div 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 h-10 text-base flex items-center justify-between cursor-pointer hover:border-blue-500"
                onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
              >
                <span>
                  {selectedCategory}
                </span>
                <span className="ml-auto text-gray-400">▼</span>
              </div>
              {categoryDropdownOpen && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {[
                    {id: 'All', label: 'All'},
                    {id: 'JM10', label: 'JM10'},
                    {id: 'JW10', label: 'JW10'},
                    {id: 'JM11-14', label: 'JM11-14'},
                    {id: 'JW11-14', label: 'JW11-14'},
                    {id: 'JM15-17', label: 'JM15-17'},
                    {id: 'JW15-17', label: 'JW15-17'},
                    {id: 'SM18-19', label: 'SM18-19'},
                    {id: 'SW18-19', label: 'SW18-19'},
                    {id: 'SM20-24', label: 'SM20-24'},
                    {id: 'SW20-24', label: 'SW20-24'},
                    {id: 'SM25-29', label: 'SM25-29'},
                    {id: 'SW25-29', label: 'SW25-29'},
                    {id: 'SM30-34', label: 'SM30-34'},
                    {id: 'SW30-34', label: 'SW30-34'},
                    {id: 'VM35-39', label: 'VM35-39'},
                    {id: 'VW35-39', label: 'VW35-39'},
                    {id: 'VM40-44', label: 'VM40-44'},
                    {id: 'VW40-44', label: 'VW40-44'},
                    {id: 'VM45-49', label: 'VM45-49'},
                    {id: 'VW45-49', label: 'VW45-49'},
                    {id: 'VM50-54', label: 'VM50-54'},
                    {id: 'VW50-54', label: 'VW50-54'},
                    {id: 'VM55-59', label: 'VM55-59'},
                    {id: 'VW55-59', label: 'VW55-59'},
                    {id: 'VM60-64', label: 'VM60-64'},
                    {id: 'VW60-64', label: 'VW60-64'},
                    {id: 'VM65-69', label: 'VM65-69'},
                    {id: 'VW65-69', label: 'VW65-69'},
                    {id: 'VM70-74', label: 'VM70-74'},
                    {id: 'VW70-74', label: 'VW70-74'},
                    {id: 'VM75+', label: 'VM75+'},
                    {id: 'VW75+', label: 'VW75+'}
                  ].map(cat => (
                    <div 
                      key={cat.id}
                      className={`px-3 py-2 cursor-pointer hover:bg-blue-50 ${selectedCategory === cat.id ? 'bg-blue-50' : ''}`}
                      onClick={() => {
                        setSelectedCategory(cat.id);
                        setCategoryDropdownOpen(false);
                      }}
                    >
                      {cat.label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col">
              <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
              <div className="flex items-center h-10">
                 <div className="w-full bg-gray-200 rounded-full h-3">
                   <div 
                     className="h-3 rounded-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500"
                     style={{ width: `${Math.min(100, ((selectedParkrun ? getDifficulty({parkrun: selectedParkrun}) : 1) - 0.8) * 250)}%` }}
                   ></div>
                 </div>
                 <span className="ml-2 text-base font-mono">{selectedParkrun ? (getDifficulty({parkrun: selectedParkrun}) * 100).toFixed(2) : ''}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Search Filter */}
        <div className="mb-4">
          <input 
            type="text"
            placeholder="Search parkruns..."
            className="w-full border border-gray-300 rounded-lg px-4 py-2"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>

        <div className="mb-2 text-xs text-gray-500 text-right">
          Click column headers to sort • Click row for course details
        </div>

        {/* Results Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th 
                  className="px-3 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('name')}
                >
                  Parkrun {sortBy === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('time')}
                >
                  Est Time {sortBy === 'time' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-3 py-3 text-right text-sm font-medium text-gray-700">
                  Difference
                </th>
                <th 
                  className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('difficulty')}
                >
                  Difficulty {sortBy === 'difficulty' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th 
                  className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('elevation')}
                >
                  Elevation {sortBy === 'elevation' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                 <th className="px-3 py-3 text-center text-sm font-medium text-gray-700">
                   Terrain
                 </th>
                 <th 
                   className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                   onClick={() => handleSort('distance')}
                 >
                   Distance {sortBy === 'distance' && (sortDirection === 'asc' ? '↑' : '↓')}
                 </th>
                 <th 
                   className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                   onClick={() => handleSort('runners')}
                 >
                   Avg Runners {sortBy === 'runners' && (sortDirection === 'asc' ? '↑' : '↓')}
                 </th>
                <th 
                  className={`px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 ${selectedCategory !== 'All' ? 'bg-blue-50' : ''}`}
                >
                  {useAgeGrade ? 'Avg Age Grade' : 'Avg Time'}
                </th>
                <th 
                  className={`px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 ${selectedCategory !== 'All' ? 'bg-blue-50' : ''}`}
                >
                  {useAgeGrade ? 'Median' : 'Median'}
                </th>
                <th 
                  className={`px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 ${selectedCategory !== 'All' ? 'bg-blue-50' : ''}`}
                >
                  Fastest
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.map((result) => (
                <tr 
                  key={result.parkrun.id}
                  className={`border-t cursor-pointer hover:bg-gray-50 ${
                    result.parkrun.id === selectedParkrun?.id ? 'bg-blue-50' :
                    result.timeDifference < 0 ? 'bg-green-50/30' :
                    result.timeDifference > 0 ? 'bg-orange-50/30' : ''
                  } ${selectedResult?.parkrun.id === result.parkrun.id ? 'ring-2 ring-blue-500' : ''}`}
                  onClick={(e) => {
                    const newSelected = selectedResult?.parkrun.id === result.parkrun.id ? null : result;
                    setSelectedResult(newSelected);
                    if (newSelected) {
                      e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }}
                >
                  <td className="px-3 py-3">
                    <div className="font-medium">{result.parkrun.name}</div>
                    <div className="text-xs text-gray-500">{result.parkrun.region}, {result.parkrun.country}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{secondsToTime(result.estimatedTime)}</td>
                  <td className={`px-3 py-3 text-right font-mono ${result.timeDifference < 0 ? 'text-green-600' : result.timeDifference > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {formatTimeDifference(result.timeDifference)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{(getDifficulty(result) * 100).toFixed(2)}</td>
                   <td className="px-3 py-3 text-right">{result.parkrun.elevation}m</td>
                   <td className="px-3 py-3 text-center capitalize text-sm">{result.parkrun.terrain}</td>
                   <td className="px-3 py-3 text-right font-mono">
                     {selectedParkrun?.latitude && result.parkrun.latitude ? ((() => {
                       const R = 6371; // Earth radius in km
                       const dLat = (result.parkrun.latitude - selectedParkrun.latitude) * Math.PI / 180;
                       const dLon = (result.parkrun.longitude - selectedParkrun.longitude) * Math.PI / 180;
                       const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                                 Math.cos(selectedParkrun.latitude * Math.PI / 180) * Math.cos(result.parkrun.latitude * Math.PI / 180) *
                                 Math.sin(dLon/2) * Math.sin(dLon/2);
                       const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                       const distance = R * c;
                       return `${distance.toFixed(1)} km`;
                     })()) : ''}
                   </td>
                   <td className="px-3 py-3 text-right font-mono">{Math.round(result.parkrun.totalRunners / result.parkrun.totalEvents)}</td>
                   <td className={`px-3 py-3 text-right font-mono ${selectedCategory !== 'All' ? 'bg-blue-50' : ''}`}>
                     {useAgeGrade 
                       ? `${(result.parkrun.monthlyStats[selectedMonth]?.ageGender[selectedCategory]?.averageAgeGrade || result.parkrun.monthlyStats[0]?.ageGender[selectedCategory]?.averageAgeGrade || 60).toFixed(1)}%`
                       : secondsToTime(result.parkrun.monthlyStats[selectedMonth]?.ageGender[selectedCategory]?.average || result.parkrun.monthlyStats[0]?.ageGender[selectedCategory]?.average || result.parkrun.monthlyStats[selectedMonth]?.averageTime || result.parkrun.monthlyStats[0]?.averageTime || 1500)
                     }
                   </td>
                  <td className={`px-3 py-3 text-right font-mono ${selectedCategory !== 'All' ? 'bg-blue-50' : ''}`}>
                    {useAgeGrade 
                       ? `${(result.parkrun.monthlyStats[selectedMonth]?.ageGender[selectedCategory]?.medianAgeGrade || result.parkrun.monthlyStats[0]?.ageGender[selectedCategory]?.medianAgeGrade || 60).toFixed(1)}%`
                       : secondsToTime(result.parkrun.monthlyStats[selectedMonth]?.ageGender[selectedCategory]?.median || result.parkrun.monthlyStats[0]?.ageGender[selectedCategory]?.median || result.parkrun.monthlyStats[selectedMonth]?.medianTime || result.parkrun.monthlyStats[0]?.medianTime || 1500)
                     }
                  </td>
                  <td className={`px-3 py-3 text-right font-mono ${selectedCategory !== 'All' ? 'bg-blue-50' : ''}`}>
                    {useAgeGrade 
                       ? `${(result.parkrun.monthlyStats[selectedMonth]?.ageGender[selectedCategory]?.fastestAgeGrade || result.parkrun.monthlyStats[0]?.ageGender[selectedCategory]?.fastestAgeGrade || 85).toFixed(1)}%`
                       : secondsToTime(result.parkrun.monthlyStats[selectedMonth]?.ageGender[selectedCategory]?.fastest || result.parkrun.monthlyStats[0]?.ageGender[selectedCategory]?.fastest || result.parkrun.monthlyStats[selectedMonth]?.fastestTime || result.parkrun.monthlyStats[0]?.fastestTime || 1000)
                     }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Selected Course Details */}
        {selectedResult && (
          <div className="mt-6 bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">{selectedResult.parkrun.name}</h3>
              <a href={selectedResult.parkrun.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">
                View official parkrun page →
              </a>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500">Difficulty</div>
                <div className="text-xl font-bold">{(getDifficulty(selectedResult) * 100).toFixed(2)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500">Elevation</div>
                <div className="text-xl font-bold">{selectedResult.parkrun.elevation}m</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500">Terrain</div>
                <div className="text-xl font-bold capitalize">{selectedResult.parkrun.terrain}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500">Events</div>
                <div className="text-xl font-bold">{selectedResult.parkrun.totalEvents}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500">Avg Runners</div>
                <div className="text-xl font-bold">{Math.round(selectedResult.parkrun.totalRunners / selectedResult.parkrun.totalEvents)}</div>
              </div>
            </div>

            <p className="text-gray-700 mb-4">{selectedResult.parkrun.courseDescription}</p>

            <div className="flex items-center mb-2">
              <h4 className="font-bold">Age Category Times</h4>
              <div className="ml-6 flex bg-gray-100 rounded-md border border-gray-200 shrink-0">
                <button
                  onClick={() => setUseDetailViewTime(true)}
                  className={`px-3 py-1 text-xs font-medium rounded-l-md transition-all ${useDetailViewTime ? 'bg-blue-500 text-white shadow' : 'bg-transparent text-gray-600 hover:text-gray-900'}`}
                >
                  Finishing Time
                </button>
                <button
                  onClick={() => setUseDetailViewTime(false)}
                  className={`px-3 py-1 text-xs font-medium rounded-r-md transition-all ${!useDetailViewTime ? 'bg-blue-500 text-white shadow' : 'bg-transparent text-gray-600 hover:text-gray-900'}`}
                >
                  Age Grade
                </button>
              </div>
              <div className="ml-auto flex flex-wrap gap-1.5 max-w-3/4">
                <button
                  key="all"
                  onClick={() => setSelectedDetailsMonth(0)}
                  className={`px-3 py-1 text-xs rounded text-center ${selectedDetailsMonth === 0 ? 'bg-blue-500 text-white' : 'bg-blue-100 hover:bg-blue-200'}`}
                >
                  All
                </button>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                  <button
                    key={m}
                    onClick={() => setSelectedDetailsMonth(m)}
                    className={`px-3 py-1 text-xs rounded text-center ${selectedDetailsMonth === m ? 'bg-blue-500 text-white' : 'bg-blue-100 hover:bg-blue-200'}`}
                  >
                    {months[m-1].substring(0, 3)}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto mb-4">
              {/* All category spans full width */}
              <table className="w-full text-sm mb-0">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left font-medium">Category</th>
                    <th className="px-3 py-2 text-right font-medium">Average</th>
                    <th className="px-3 py-2 text-right font-medium">Median</th>
                    <th className="px-3 py-2 text-right font-medium pr-6">Fastest</th>
                    <th className="px-3 py-2 text-left font-medium pl-6">Category</th>
                    <th className="px-3 py-2 text-right font-medium">Average</th>
                    <th className="px-3 py-2 text-right font-medium">Median</th>
                    <th className="px-3 py-2 text-right font-medium">Fastest</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const ageGender = selectedResult.parkrun.monthlyStats[selectedDetailsMonth]?.ageGender || 
                                      selectedResult.parkrun.monthlyStats[1]?.ageGender || {};
                    
                    // Separate All, male and female categories
                    const allCat = ageGender['All'];
                    const maleCats = Object.entries(ageGender).filter(([cat]) => cat.startsWith('JM') || cat.startsWith('SM') || cat.startsWith('VM'));
                    const femaleCats = Object.entries(ageGender).filter(([cat]) => cat.startsWith('JW') || cat.startsWith('SW') || cat.startsWith('VW'));
                    
                    const rows = [];
                    
                    // All category aligned with left column
                    if (allCat) {
                      rows.push(
                        <tr key="All" className="border-t font-semibold bg-gray-50/50">
                          <td className="px-3 py-2 font-medium">All</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {useDetailViewTime ? secondsToTime(allCat.average) : `${allCat.averageAgeGrade?.toFixed(1)}%`}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {useDetailViewTime ? secondsToTime(allCat.median) : `${allCat.medianAgeGrade?.toFixed(1)}%`}
                          </td>
                          <td className="px-3 py-2 text-right font-mono pr-6">
                            {useDetailViewTime ? secondsToTime(allCat.fastest) : `${allCat.fastestAgeGrade?.toFixed(1)}%`}
                          </td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2"></td>
                        </tr>
                      );
                    }
                    
                    // Side by side male / female rows
                    const maxRows = Math.max(maleCats.length, femaleCats.length);
                    for (let i = 0; i < maxRows; i++) {
                      const [maleCat, maleStats] = maleCats[i] || ['', null];
                      const [femaleCat, femaleStats] = femaleCats[i] || ['', null];
                      
                      rows.push(
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 font-medium text-blue-700">{maleCat}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {maleStats ? (useDetailViewTime ? secondsToTime(maleStats.average) : `${maleStats.averageAgeGrade?.toFixed(1)}%`) : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {maleStats ? (useDetailViewTime ? secondsToTime(maleStats.median) : `${maleStats.medianAgeGrade?.toFixed(1)}%`) : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono pr-6">
                            {maleStats ? (useDetailViewTime ? secondsToTime(maleStats.fastest) : `${maleStats.fastestAgeGrade?.toFixed(1)}%`) : ''}
                          </td>
                          <td className="px-3 py-2 font-medium text-pink-700 pl-6">{femaleCat}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {femaleStats ? (useDetailViewTime ? secondsToTime(femaleStats.average) : `${femaleStats.averageAgeGrade?.toFixed(1)}%`) : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {femaleStats ? (useDetailViewTime ? secondsToTime(femaleStats.median) : `${femaleStats.medianAgeGrade?.toFixed(1)}%`) : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {femaleStats ? (useDetailViewTime ? secondsToTime(femaleStats.fastest) : `${femaleStats.fastestAgeGrade?.toFixed(1)}%`) : ''}
                          </td>
                        </tr>
                      );
                    }
                    
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>

            {/* Course Map */}
            <div>
              <h4 className="font-bold mb-2">Course Map</h4>
              <iframe 
                title="Parkrun map"
                className="w-full aspect-video rounded-lg border"
                src={`https://maps.google.com/maps?q=${encodeURIComponent(selectedResult.parkrun.name + ' parkrun')}&t=k&z=16&output=embed`}
                allowFullScreen
                loading="lazy"
              ></iframe>
            </div>
          </div>
        )}

        {/* About Section */}
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-bold mb-4">How this works</h3>
          <p className="text-gray-700 mb-3">
            This calculator uses percentile matching to accurately estimate your time at different parkrun courses.
          </p>
          <ol className="list-decimal list-inside text-gray-700 space-y-2 mb-4">
            <li>Your time is first mapped to what percentile you achieved at your course</li>
            <li>We then find what time matches that exact same percentile at every other course</li>
            <li>Seasonal adjustments are applied for month-to-month weather variations</li>
          </ol>
          <p className="text-gray-600 text-sm">
            Difficulty factor 1.0 = average course. Lower is easier, higher is harder.
          </p>
        </div>
      </main>

      <footer className="mt-12 border-t bg-white py-6">
        <div className="max-w-6xl mx-auto px-4 text-center text-gray-500 text-sm">
          Parkrun Pacer • Not affiliated with parkrun UK
        </div>
      </footer>
    </div>
  )
}