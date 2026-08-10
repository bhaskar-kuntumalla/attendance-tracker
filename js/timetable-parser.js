// ============================================================
// timetable-parser.js — Deterministic JavaScript Timetable Parser
// Converts raw OCR text lines into structured timetable JSON.
// Handles both Day-as-Row and Day-as-Column timetable layouts.
// ============================================================

export const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DAY_REGEX = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/i;
const TIME_REGEX = /(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?\s*(?:to|-|—)\s*(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i;
const PERIOD_HEADER_REGEX = /(?:period|p|slot)\s*(\d+)/i;
const BREAK_REGEX = /(lunch|break|recess|tea|snack)/i;
const LAB_REGEX = /(lab|practical|workshop|laboratory|project|viva)/i;

// Parse raw OCR text into structured intermediate object
export function parseTimetableText(rawText) {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const detectedDays = new Set();
  const rawEntries = [];
  let detectedPeriods = [];

  // Step 1: Detect explicit periods or time headers in text
  detectedPeriods = extractPeriodsFromText(lines);
  if (!detectedPeriods.length) {
    detectedPeriods = getDefaultPeriods();
  }

  // Step 2: Extract day sections and entry lines
  let currentDay = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Check if line contains a Day name
    const dayMatch = line.match(DAY_REGEX);
    if (dayMatch && (line.length < 25 || isDayHeaderLine(line))) {
      const canonicalDay = matchCanonicalDay(dayMatch[1]);
      if (canonicalDay) {
        currentDay = canonicalDay;
        detectedDays.add(canonicalDay);
        continue;
      }
    }

    // Skip lines that are purely page titles or table borders
    if (isJunkLine(line)) continue;

    // Check if line is a break line
    if (BREAK_REGEX.test(line) && !line.match(/[a-z]{3,}\s+(lab|theory|subject)/i)) {
      continue;
    }

    // Try parsing line as [Time/Period] [Subject] or subject line under currentDay
    const parsed = parseLineForEntry(line, currentDay, detectedPeriods);
    if (parsed) {
      if (parsed.day_of_week) detectedDays.add(parsed.day_of_week);
      rawEntries.push(parsed);
    }
  }

  // Step 3: Fallback parsing if day structure was columnar or unanchored
  if (rawEntries.length === 0) {
    const columnarEntries = parseColumnarLayout(lines, detectedPeriods);
    rawEntries.push(...columnarEntries);
  }

  // Step 4: Clean, deduplicate, and assign proper period numbers & period counts
  const entries = normalizeEntries(rawEntries, detectedPeriods);

  return {
    periods: detectedPeriods,
    entries: entries,
    detectedDays: Array.from(detectedDays),
  };
}

// Convert day string to canonical title case
export function matchCanonicalDay(str) {
  if (!str) return null;
  const s = str.toLowerCase();
  if (s.startsWith("mon")) return "Monday";
  if (s.startsWith("tue")) return "Tuesday";
  if (s.startsWith("wed")) return "Wednesday";
  if (s.startsWith("thu")) return "Thursday";
  if (s.startsWith("fri")) return "Friday";
  if (s.startsWith("sat")) return "Saturday";
  if (s.startsWith("sun")) return "Sunday";
  return null;
}

// Helper to test if line is a day header
function isDayHeaderLine(line) {
  const parts = line.split(/[\s,|-]+/);
  return parts.some((p) => DAY_REGEX.test(p));
}

// Ignore header/footer junk
function isJunkLine(line) {
  const lower = line.toLowerCase();
  return (
    lower.includes("weekly timetable") ||
    lower.includes("class routine") ||
    lower.includes("time table") ||
    lower.startsWith("page ") ||
    lower.startsWith("---") ||
    lower.startsWith("===") ||
    line.length < 2
  );
}

// Extract periods or times from text
function extractPeriodsFromText(lines) {
  const periods = [];
  let periodNum = 1;

  for (const line of lines) {
    const timeMatch = line.match(TIME_REGEX);
    if (timeMatch) {
      const startTime = format24Hour(timeMatch[1], timeMatch[2], timeMatch[3]);
      const endTime = format24Hour(timeMatch[4], timeMatch[5], timeMatch[6]);
      const isBreak = BREAK_REGEX.test(line);

      // Avoid duplicate period definitions
      if (!periods.some((p) => p.start_time === startTime && p.end_time === endTime)) {
        periods.push({
          period_number: periodNum++,
          name: isBreak ? "Lunch / Break" : `Period ${periodNum}`,
          start_time: startTime,
          end_time: endTime,
          is_break: isBreak,
          sort_order: periodNum,
        });
      }
    }
  }

  return periods;
}

// Default standard college period timings fallback
export function getDefaultPeriods() {
  return [
    { period_number: 1, name: "Period 1", start_time: "09:00", end_time: "10:00", is_break: false, sort_order: 1 },
    { period_number: 2, name: "Period 2", start_time: "10:00", end_time: "11:00", is_break: false, sort_order: 2 },
    { period_number: 3, name: "Period 3", start_time: "11:00", end_time: "12:00", is_break: false, sort_order: 3 },
    { period_number: 4, name: "Lunch Break", start_time: "12:00", end_time: "13:00", is_break: true, sort_order: 4 },
    { period_number: 5, name: "Period 4", start_time: "13:00", end_time: "14:00", is_break: false, sort_order: 5 },
    { period_number: 6, name: "Period 5", start_time: "14:00", end_time: "15:00", is_break: false, sort_order: 6 },
    { period_number: 7, name: "Period 6", start_time: "15:00", end_time: "16:00", is_break: false, sort_order: 7 },
  ];
}

// Parse a single text line into a candidate timetable entry
function parseLineForEntry(line, currentDay, periods) {
  if (BREAK_REGEX.test(line) && !LAB_REGEX.test(line)) return null;

  let day = currentDay || "Monday";
  let subjectName = line;
  let periodNum = 1;
  let startTime = null;
  let endTime = null;
  let room = null;
  let faculty = null;

  // Extract explicit day if embedded in line (e.g. "Mon DBMS 09:00-10:00")
  const dayMatch = line.match(DAY_REGEX);
  if (dayMatch) {
    const canon = matchCanonicalDay(dayMatch[1]);
    if (canon) day = canon;
    subjectName = subjectName.replace(dayMatch[0], "").trim();
  }

  // Extract time if embedded
  const timeMatch = subjectName.match(TIME_REGEX);
  if (timeMatch) {
    startTime = format24Hour(timeMatch[1], timeMatch[2], timeMatch[3]);
    endTime = format24Hour(timeMatch[4], timeMatch[5], timeMatch[6]);
    subjectName = subjectName.replace(timeMatch[0], "").trim();
  }

  // Extract period number if embedded (e.g. "P1 DBMS", "Period 2 OS")
  const periodMatch = subjectName.match(PERIOD_HEADER_REGEX);
  if (periodMatch) {
    periodNum = parseInt(periodMatch[1], 10);
    subjectName = subjectName.replace(periodMatch[0], "").trim();
  }

  // Extract room / hall if present (e.g. "Room 302", "Hall B")
  const roomMatch = subjectName.match(/(?:room|hall|lh|lab)\s*[:#-]?\s*([a-z0-9-]+)/i);
  if (roomMatch) {
    room = roomMatch[0];
  }

  // Clean subject name
  subjectName = cleanSubjectName(subjectName);
  if (!subjectName || subjectName.length < 2) return null;

  const isLab = LAB_REGEX.test(subjectName);
  const subjectType = isLab ? "LAB" : "THEORY";
  const periodCount = isLab ? 2 : 1;

  // Infer subject code if available
  const subjectCode = extractSubjectCode(subjectName);

  return {
    day_of_week: day,
    period_number: periodNum,
    subject_name: subjectName,
    subject_code: subjectCode,
    subject_type: subjectType,
    period_count: periodCount,
    start_time: startTime,
    end_time: endTime,
    room,
    faculty,
  };
}

// Fallback parser for column-based table text
function parseColumnarLayout(lines, periods) {
  const entries = [];
  let currentDay = "Monday";

  for (const line of lines) {
    const dayMatch = line.match(DAY_REGEX);
    if (dayMatch) {
      const canon = matchCanonicalDay(dayMatch[1]);
      if (canon) currentDay = canon;
    }

    // Split line by tabs, multiple spaces, or pipes
    const tokens = line.split(/[\t|]{1,}|\s{2,}/).map((t) => t.trim()).filter(Boolean);

    let periodIdx = 1;
    for (const tok of tokens) {
      if (DAY_REGEX.test(tok) || BREAK_REGEX.test(tok) || isJunkLine(tok)) continue;
      const clean = cleanSubjectName(tok);
      if (clean && clean.length >= 2) {
        const isLab = LAB_REGEX.test(clean);
        entries.push({
          day_of_week: currentDay,
          period_number: periodIdx,
          subject_name: clean,
          subject_code: extractSubjectCode(clean),
          subject_type: isLab ? "LAB" : "THEORY",
          period_count: isLab ? 2 : 1,
          start_time: periods[periodIdx - 1]?.start_time || null,
          end_time: periods[periodIdx - 1]?.end_time || null,
          room: null,
          faculty: null,
        });
        periodIdx += isLab ? 2 : 1;
      }
    }
  }

  return entries;
}

// Clean noisy text from OCR output
function cleanSubjectName(str) {
  if (!str) return "";
  let s = str
    .replace(/[\|\[\]\(\)\{\}\*\#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip leading punctuation
  s = s.replace(/^[^a-zA-Z0-9]+/, "");
  // Strip trailing punctuation
  s = s.replace(/[^a-zA-Z0-9]+$/, "");

  // If text starts with period indicator like "1.", "P1:", remove it
  s = s.replace(/^(?:p\d+|\d+[\.:\s]+)\s*/i, "");

  return s;
}

// Extract concise subject code if available (e.g. "DBMS", "CS301", "OS")
function extractSubjectCode(subjectName) {
  if (!subjectName) return null;

  // Check if string is already a code like "DBMS", "CS301", "MATHS"
  if (/^[A-Z0-9]{2,8}$/.test(subjectName)) return subjectName;

  // Check for explicit code in parentheses e.g. "Database Systems (DBMS)"
  const codeMatch = subjectName.match(/\(([^)]+)\)/);
  if (codeMatch && codeMatch[1].length <= 8) return codeMatch[1].toUpperCase();

  // Create acronym for long names (e.g., "Database Management Systems" -> "DBMS")
  const words = subjectName.split(/\s+/).filter((w) => w.length > 0 && !/^(and|of|the|for|in|lab)$/i.test(w));
  if (words.length >= 2 && words.length <= 5) {
    const acronym = words.map((w) => w[0]).join("").toUpperCase();
    if (acronym.length >= 2 && acronym.length <= 6) return acronym;
  }

  return subjectName.slice(0, 8).toUpperCase();
}

// Format 12h/24h time parts into HH:MM (24-hour)
function format24Hour(hourStr, minStr = "00", ampm = "") {
  let h = parseInt(hourStr, 10);
  let m = parseInt(minStr || "0", 10);
  if (isNaN(h)) h = 9;
  if (isNaN(m)) m = 0;

  if (ampm) {
    const isPM = ampm.toLowerCase() === "pm";
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
  } else if (h < 7) {
    // Assume PM for hours 1-6 if no AM/PM specified in typical college schedule
    h += 12;
  }

  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

// Normalize entries list: sort by day/period, assign period slots
function normalizeEntries(rawEntries, periods) {
  const dayOrder = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };
  const normalized = [];

  for (const entry of rawEntries) {
    const periodObj = periods.find((p) => p.period_number === entry.period_number) || periods[0];
    normalized.push({
      ...entry,
      start_time: entry.start_time || periodObj?.start_time || "09:00",
      end_time: entry.end_time || periodObj?.end_time || "10:00",
    });
  }

  // Sort by day order then period number/start time
  normalized.sort((a, b) => {
    const dayDiff = (dayOrder[a.day_of_week] || 1) - (dayOrder[b.day_of_week] || 1);
    if (dayDiff !== 0) return dayDiff;
    return (a.period_number || 1) - (b.period_number || 1);
  });

  return normalized;
}

// Helper to deduplicate subject names extracted across the timetable
export function suggestSubjectMerges(entries) {
  const subjectsMap = new Map(); // normalized name -> list of variations

  for (const entry of entries) {
    const name = entry.subject_name.trim();
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (!subjectsMap.has(key)) {
      subjectsMap.set(key, { canonicalName: name, code: entry.subject_code, type: entry.subject_type, count: 1, occurrences: [entry] });
    } else {
      const existing = subjectsMap.get(key);
      existing.count++;
      existing.occurrences.push(entry);
      // Prefer longer name or uppercase code
      if (name.length > existing.canonicalName.length && !name.match(/^[A-Z]+$/)) {
        existing.canonicalName = name;
      }
    }
  }

  return Array.from(subjectsMap.values());
}
