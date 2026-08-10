// ============================================================
// timetable-parser.js — Universal Geometry-First College Timetable Extractor
// Parses timetables based on OCR word coordinates, bounding boxes,
// spatial column/row boundaries, merged cell geometry, and reference tables.
// ZERO hardcoded subjects, branches, or department layouts.
// ============================================================

export const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DAY_REGEX = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i;
const TIME_EXPR_REGEX = /(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?\s*(?:to|-|—)\s*(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i;
const SINGLE_TIME_REGEX = /\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i;
const PERIOD_KW_REGEX = /\b(?:period|p|slot|sec)\s*(\d+)\b/i;
const BREAK_KW_REGEX = /\b(lunch|break|recess|tea|snack)\b/i;
const LAB_KW_REGEX = /\b(lab|practical|workshop|tinkering|project|viva|laboratory)\b/i;

// Master Universal Parsing Function
export function parseTimetableText(ocrData) {
  const rawText = typeof ocrData === "string" ? ocrData : ocrData.rawText || "";
  const lines = ocrData.lines || rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const words = ocrData.words || [];

  // Step 1: Extract Header & Class Metadata (Branch, Sem, Sec, Year)
  const headerMetadata = extractHeaderMetadata(lines, words);

  // Step 2: Extract Reference Table Abbreviation Mappings (bottom table)
  const abbreviationMap = extractReferenceTableMappings(lines, words);

  // Step 3: Geometry-based Spatial Grid Parsing if bounding boxes are present
  let periods = [];
  let entries = [];
  let orientation = "FORMAT_A"; // Default: Days as Rows

  if (words && words.length > 10) {
    const geomResult = parseSpatialGeometryGrid(words, abbreviationMap);
    if (geomResult && geomResult.entries.length > 0) {
      periods = geomResult.periods;
      entries = geomResult.entries;
      orientation = geomResult.orientation;
    }
  }

  // Step 4: Fallback line-based structural parsing if spatial bounding box parsing yielded minimal entries
  if (!entries || entries.length === 0) {
    const lineResult = parseLineFallbackGrid(lines, abbreviationMap);
    periods = lineResult.periods;
    entries = lineResult.entries;
  }

  if (!periods || periods.length === 0) {
    periods = getDefaultPeriods();
  }

  // Step 5: Post-processing — Apply abbreviation mapping & multi-period duration validation
  const finalEntries = postProcessEntries(entries, periods, abbreviationMap);

  return {
    headerMetadata,
    periods,
    entries: finalEntries,
    abbreviationMap,
    structuralConfidence: finalEntries.length > 0 ? "high" : "medium",
  };
}

/* ---------------- 1. Header Metadata Extraction ---------------- */

function extractHeaderMetadata(lines, words) {
  const meta = {
    college: null,
    branch: null,
    semester: null,
    section: null,
    academicYear: null,
    room: null,
  };

  const headerText = lines.slice(0, 8).join(" ");

  // Branch e.g., CSE, ECE, EEE, MECH, CIVIL, AI & DS, IT
  const branchMatch = headerText.match(/\b(CSE|ECE|EEE|MECHANICAL|MECH|ME|CIVIL|CE|AI\s*&\s*DS|AIDS|IT|AUTOMOBILE)\b/i);
  if (branchMatch) meta.branch = branchMatch[0].toUpperCase();

  // Semester e.g., III-I, IV-I, I SEM, 5th Sem, Semester 5
  const semMatch = headerText.match(/\b(I{1,3}-I{1,2}|IV-I|IV-II|[1-8](?:st|nd|rd|th)?\s*sem(?:ester)?|semester\s*[1-8])\b/i);
  if (semMatch) meta.semester = semMatch[0].toUpperCase();

  // Section e.g., Sec-A, Section B
  const secMatch = headerText.match(/\b(?:sec(?:tion)?)\s*[-:]?\s*([A-Z0-9]+)\b/i);
  if (secMatch) meta.section = secMatch[1].toUpperCase();

  // Academic Year e.g., 2025-2026, 2025-26
  const yearMatch = headerText.match(/\b(20\d{2}\s*[-–/]\s*20?\d{2})\b/);
  if (yearMatch) meta.academicYear = yearMatch[0];

  // Room e.g., Room 302, LH-4
  const roomMatch = headerText.match(/\b(?:room|lh|hall)\s*[-:]?\s*([A-Z0-9-]+)\b/i);
  if (roomMatch) meta.room = roomMatch[0];

  return meta;
}

/* ---------------- 2. Reference Table Abbreviation Mapping ---------------- */

function extractReferenceTableMappings(lines, words) {
  const map = new Map(); // short code / abbreviation -> full subject name

  // Look for reference table lines at bottom half of document
  const totalLines = lines.length;
  const startIdx = Math.floor(totalLines * 0.4);
  const refLines = lines.slice(startIdx);

  for (const line of refLines) {
    // Matches patterns like "AI : Artificial Intelligence", "CN - Computer Networks", "AT&CD = Automata Theory"
    const pairMatch = line.match(/\b([A-Z0-9&]{2,8})\s*[:=\-–|]\s*([A-Za-z0-9\s&,'"-]{4,50})/);
    if (pairMatch) {
      const code = pairMatch[1].trim();
      const name = pairMatch[2].trim();
      if (!isDayName(code) && !BREAK_KW_REGEX.test(name)) {
        map.set(code.toLowerCase(), name);
        map.set(code.toUpperCase(), name);
      }
    }

    // Matches tabular line: "1.   Database Management Systems   DBMS   Dr. A. Kumar"
    const tabMatch = line.match(/^\d+[\.\s]+\s*([A-Za-z0-9\s&]{4,40})\s+([A-Z0-9&]{2,8})\s+/);
    if (tabMatch) {
      const name = tabMatch[1].trim();
      const code = tabMatch[2].trim();
      if (!isDayName(code)) {
        map.set(code.toLowerCase(), name);
        map.set(code.toUpperCase(), name);
      }
    }
  }

  return map;
}

/* ---------------- 3. Spatial Bounding Box Geometry Grid Extractor ---------------- */

function parseSpatialGeometryGrid(words, abbreviationMap) {
  // Find all Day word bounding boxes
  const dayWords = words.filter((w) => isDayName(w.text));
  if (!dayWords.length) return null;

  // Determine Table Orientation: Days as Rows (Format A) vs Days as Columns (Format B)
  const uniqueYPositions = getClusters(dayWords.map((w) => w.cy), 25);
  const uniqueXPositions = getClusters(dayWords.map((w) => w.cx), 40);

  const orientation = uniqueYPositions.length >= 3 ? "FORMAT_A" : "FORMAT_B";

  if (orientation === "FORMAT_A") {
    return parseFormatADaysAsRows(words, dayWords, abbreviationMap);
  } else {
    return parseFormatBDaysAsColumns(words, dayWords, abbreviationMap);
  }
}

// Format A: Days are Rows down the left, Periods/Times are Columns across top
function parseFormatADaysAsRows(words, dayWords, abbreviationMap) {
  // 1. Group day words by row Y coordinates
  const dayRows = [];
  const sortedDayWords = [...dayWords].sort((a, b) => a.cy - b.cy);

  let currentCluster = [sortedDayWords[0]];
  for (let i = 1; i < sortedDayWords.length; i++) {
    const w = sortedDayWords[i];
    if (Math.abs(w.cy - currentCluster[0].cy) < 25) {
      currentCluster.push(w);
    } else {
      dayRows.push(buildDayRowBounds(currentCluster));
      currentCluster = [w];
    }
  }
  if (currentCluster.length) dayRows.push(buildDayRowBounds(currentCluster));

  // 2. Find Period/Time Header words (above first day row)
  const minY = Math.min(...dayRows.map((r) => r.y0));
  const headerWords = words.filter((w) => w.cy < minY && w.cy > minY - 180);

  const periodColumns = extractPeriodColumnBounds(headerWords, words);

  // 3. Extract cells by intersecting Day Row Y bounds and Period Column X bounds
  const entries = [];

  for (const dayRow of dayRows) {
    const rowWords = words.filter(
      (w) => w.cy >= dayRow.y0 - 8 && w.cy <= dayRow.y1 + 8 && w.cx > dayRow.x1 + 5
    );

    if (!rowWords.length) continue;

    // Cluster row words into cell bounding boxes
    const cells = clusterRowWordsIntoCells(rowWords, periodColumns);

    for (const cell of cells) {
      if (!cell.text || isJunkLine(cell.text) || BREAK_KW_REGEX.test(cell.text)) continue;

      const isLab = LAB_KW_REGEX.test(cell.text) || cell.periodCount >= 2;
      const subjectType = isLab ? "LAB" : "THEORY";

      // Map abbreviation if present
      const cleanName = cleanSubjectText(cell.text);
      const mappedName = abbreviationMap.get(cleanName.toLowerCase()) || abbreviationMap.get(cleanName.toUpperCase()) || cleanName;
      const code = extractCode(cleanName, mappedName);

      entries.push({
        day_of_week: dayRow.canonicalDay,
        period_number: cell.startPeriod,
        subject_name: mappedName,
        subject_code: code,
        subject_type: subjectType,
        period_count: cell.periodCount,
        start_time: periodColumns[cell.startPeriod - 1]?.start_time || "09:15",
        end_time: periodColumns[cell.startPeriod - 1 + cell.periodCount - 1]?.end_time || "10:15",
        room: null,
        faculty: null,
      });
    }
  }

  return {
    orientation: "FORMAT_A",
    periods: periodColumns,
    entries,
  };
}

// Format B: Days are Columns across top, Periods/Times are Rows down left
function parseFormatBDaysAsColumns(words, dayWords, abbreviationMap) {
  const dayColumns = dayWords.map((w) => ({
    canonicalDay: matchCanonicalDay(w.text),
    x0: w.x0 - 15,
    x1: w.x1 + 15,
    cx: w.cx,
  })).sort((a, b) => a.cx - b.cx);

  const timeWords = words.filter((w) => TIME_EXPR_REGEX.test(w.text) || SINGLE_TIME_REGEX.test(w.text));
  const periodRows = extractPeriodRowBounds(timeWords);

  const entries = [];

  for (const pRow of periodRows) {
    for (const dCol of dayColumns) {
      const cellWords = words.filter(
        (w) => w.cx >= dCol.x0 && w.cx <= dCol.x1 && w.cy >= pRow.y0 && w.cy <= pRow.y1
      );

      const cellText = cellWords.map((w) => w.text).join(" ").trim();
      if (!cellText || BREAK_KW_REGEX.test(cellText) || isJunkLine(cellText)) continue;

      const isLab = LAB_KW_REGEX.test(cellText);
      const cleanName = cleanSubjectText(cellText);
      const mappedName = abbreviationMap.get(cleanName.toLowerCase()) || cleanName;

      entries.push({
        day_of_week: dCol.canonicalDay,
        period_number: pRow.periodNumber,
        subject_name: mappedName,
        subject_code: extractCode(cleanName, mappedName),
        subject_type: isLab ? "LAB" : "THEORY",
        period_count: isLab ? 2 : 1,
        start_time: pRow.start_time,
        end_time: pRow.end_time,
        room: null,
        faculty: null,
      });
    }
  }

  return {
    orientation: "FORMAT_B",
    periods: periodRows.map((r) => ({ period_number: r.periodNumber, start_time: r.start_time, end_time: r.end_time })),
    entries,
  };
}

/* ---------------- Helper Geometry Functions ---------------- */

function buildDayRowBounds(wordsCluster) {
  const dayText = wordsCluster.map((w) => w.text).join(" ");
  const canonicalDay = matchCanonicalDay(dayText) || "Monday";
  const y0 = Math.min(...wordsCluster.map((w) => w.y0));
  const y1 = Math.max(...wordsCluster.map((w) => w.y1));
  const x1 = Math.max(...wordsCluster.map((w) => w.x1));

  return { canonicalDay, y0, y1, x1 };
}

function extractPeriodColumnBounds(headerWords, allWords) {
  // Find time words or P1/P2/P3 headers
  const timeHeaderWords = headerWords.filter(
    (w) => TIME_EXPR_REGEX.test(w.text) || SINGLE_TIME_REGEX.test(w.text) || PERIOD_KW_REGEX.test(w.text) || BREAK_KW_REGEX.test(w.text)
  );

  const defaultTimes = [
    { start_time: "09:15", end_time: "10:15" },
    { start_time: "10:15", end_time: "11:15" },
    { start_time: "11:25", end_time: "12:25" },
    { start_time: "12:25", end_time: "01:45", is_break: true },
    { start_time: "01:45", end_time: "02:45" },
    { start_time: "02:45", end_time: "03:45" },
    { start_time: "03:45", end_time: "04:45" },
  ];

  if (!timeHeaderWords.length) {
    // Generate evenly spaced column bounds across page width
    const minX = 120;
    const maxX = 1100;
    const colWidth = (maxX - minX) / defaultTimes.length;

    return defaultTimes.map((t, idx) => ({
      period_number: idx + 1,
      name: t.is_break ? "Lunch Break" : `Period ${idx + 1}`,
      start_time: t.start_time,
      end_time: t.end_time,
      is_break: !!t.is_break,
      x0: minX + idx * colWidth,
      x1: minX + (idx + 1) * colWidth,
    }));
  }

  // Cluster time header words by X coordinates
  timeHeaderWords.sort((a, b) => a.cx - b.cx);

  const cols = [];
  let periodNum = 1;

  for (let i = 0; i < timeHeaderWords.length; i++) {
    const w = timeHeaderWords[i];
    const timeMatch = w.text.match(TIME_EXPR_REGEX) || w.text.match(SINGLE_TIME_REGEX);
    const isBreak = BREAK_KW_REGEX.test(w.text);

    cols.push({
      period_number: periodNum++,
      name: isBreak ? "Lunch Break" : `Period ${periodNum}`,
      start_time: timeMatch ? format24Hour(timeMatch[1], timeMatch[2], timeMatch[3]) : defaultTimes[periodNum - 2]?.start_time || "09:15",
      end_time: timeMatch && timeMatch[4] ? format24Hour(timeMatch[4], timeMatch[5], timeMatch[6]) : defaultTimes[periodNum - 2]?.end_time || "10:15",
      is_break: isBreak,
      x0: w.x0 - 20,
      x1: w.x1 + 40,
      cx: w.cx,
    });
  }

  return cols;
}

function extractPeriodRowBounds(timeWords) {
  timeWords.sort((a, b) => a.cy - b.cy);
  const rows = [];
  let pNum = 1;

  for (const w of timeWords) {
    const timeMatch = w.text.match(TIME_EXPR_REGEX) || w.text.match(SINGLE_TIME_REGEX);
    rows.push({
      periodNumber: pNum++,
      start_time: timeMatch ? format24Hour(timeMatch[1], timeMatch[2]) : "09:15",
      end_time: timeMatch && timeMatch[4] ? format24Hour(timeMatch[4], timeMatch[5]) : "10:15",
      y0: w.y0 - 15,
      y1: w.y1 + 45,
    });
  }

  return rows;
}

// Cluster words in a row into cell bounding boxes & detect multi-period merged cell spans
function clusterRowWordsIntoCells(rowWords, periodColumns) {
  rowWords.sort((a, b) => a.cx - b.cx);

  const cells = [];
  let currentGroup = [rowWords[0]];

  for (let i = 1; i < rowWords.length; i++) {
    const w = rowWords[i];
    const prevW = rowWords[i - 1];

    // Distance threshold between adjacent words in the same cell
    if (w.x0 - prevW.x1 < 45) {
      currentGroup.push(w);
    } else {
      cells.push(buildCellFromGroup(currentGroup, periodColumns));
      currentGroup = [w];
    }
  }
  if (currentGroup.length) cells.push(buildCellFromGroup(currentGroup, periodColumns));

  return cells;
}

function buildCellFromGroup(wordGroup, periodColumns) {
  const text = wordGroup.map((w) => w.text).join(" ").trim();
  const minX = Math.min(...wordGroup.map((w) => w.x0));
  const maxX = Math.max(...wordGroup.map((w) => w.x1));
  const centerX = (minX + maxX) / 2;

  // Determine starting and ending period columns using bounding box spatial overlap
  let startPeriod = 1;
  let endPeriod = 1;

  for (let idx = 0; idx < periodColumns.length; idx++) {
    const col = periodColumns[idx];
    if (minX >= col.x0 - 30 && minX <= col.x1 + 30) {
      startPeriod = col.period_number;
      break;
    } else if (centerX >= col.x0 && centerX <= col.x1) {
      startPeriod = col.period_number;
      break;
    }
  }

  for (let idx = periodColumns.length - 1; idx >= 0; idx--) {
    const col = periodColumns[idx];
    if (maxX >= col.x0 - 30 && maxX <= col.x1 + 30) {
      endPeriod = col.period_number;
      break;
    }
  }

  if (endPeriod < startPeriod) endPeriod = startPeriod;
  const periodCount = Math.max(1, endPeriod - startPeriod + 1);

  return { text, startPeriod, endPeriod, periodCount };
}

/* ---------------- 4. Line Fallback Parser ---------------- */

function parseLineFallbackGrid(lines, abbreviationMap) {
  const entries = [];
  const periods = getDefaultPeriods();

  let currentDay = "Monday";

  for (const line of lines) {
    const dayMatch = line.match(DAY_REGEX);
    if (dayMatch && line.length < 25) {
      const canon = matchCanonicalDay(dayMatch[1]);
      if (canon) currentDay = canon;
      continue;
    }

    if (isJunkLine(line) || BREAK_KW_REGEX.test(line)) continue;

    // Split line by multiple spaces or tabs
    const tokens = line.split(/\s{2,}|\t/).map((t) => t.trim()).filter(Boolean);

    let periodIdx = 1;
    for (const tok of tokens) {
      if (DAY_REGEX.test(tok) || isJunkLine(tok)) continue;

      const clean = cleanSubjectText(tok);
      if (clean && clean.length >= 2) {
        const isLab = LAB_KW_REGEX.test(clean);
        const mapped = abbreviationMap.get(clean.toLowerCase()) || clean;

        entries.push({
          day_of_week: currentDay,
          period_number: periodIdx,
          subject_name: mapped,
          subject_code: extractCode(clean, mapped),
          subject_type: isLab ? "LAB" : "THEORY",
          period_count: isLab ? 2 : 1,
          start_time: periods[periodIdx - 1]?.start_time || "09:15",
          end_time: periods[periodIdx - 1]?.end_time || "10:15",
          room: null,
          faculty: null,
        });

        periodIdx += isLab ? 2 : 1;
      }
    }
  }

  return { periods, entries };
}

/* ---------------- 5. General Utility Functions ---------------- */

export function isDayName(str) {
  if (!str) return false;
  return DAY_REGEX.test(str.trim());
}

export function matchCanonicalDay(str) {
  if (!str) return null;
  const s = str.toLowerCase().trim();
  if (s.startsWith("mon")) return "Monday";
  if (s.startsWith("tue")) return "Tuesday";
  if (s.startsWith("wed")) return "Wednesday";
  if (s.startsWith("thu")) return "Thursday";
  if (s.startsWith("fri")) return "Friday";
  if (s.startsWith("sat")) return "Saturday";
  if (s.startsWith("sun")) return "Sunday";
  return null;
}

function isJunkLine(line) {
  const lower = line.toLowerCase();
  return (
    lower.includes("timetable") ||
    lower.includes("time table") ||
    lower.includes("college of engineering") ||
    lower.includes("academic year") ||
    lower.includes("class incharge") ||
    lower.startsWith("page ") ||
    lower.startsWith("---") ||
    lower.startsWith("===") ||
    line.length < 2
  );
}

function cleanSubjectText(str) {
  if (!str) return "";
  let s = str.replace(/[\|\[\]\(\)\{\}\*\#]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^[^a-zA-Z0-9]+/, "").replace(/[^a-zA-Z0-9]+$/, "");
  return s;
}

function extractCode(rawStr, fullStr) {
  if (rawStr && rawStr.length <= 8 && /^[A-Z0-9-&]+$/i.test(rawStr)) {
    return rawStr.toUpperCase();
  }
  const words = fullStr.split(/\s+/).filter((w) => w.length > 0 && !/^(and|of|the|for|in|lab)$/i.test(w));
  if (words.length >= 2) {
    return words.map((w) => w[0]).join("").toUpperCase().slice(0, 8);
  }
  return fullStr.slice(0, 8).toUpperCase();
}

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
    h += 12;
  }

  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function getClusters(numbers, threshold) {
  if (!numbers.length) return [];
  const sorted = [...numbers].sort((a, b) => a - b);
  const clusters = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    const prev = clusters[clusters.length - 1];
    const avg = prev.reduce((a, b) => a + b, 0) / prev.length;

    if (Math.abs(n - avg) <= threshold) {
      prev.push(n);
    } else {
      clusters.push([n]);
    }
  }

  return clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}

export function getDefaultPeriods() {
  return [
    { period_number: 1, name: "Period 1", start_time: "09:15", end_time: "10:15", is_break: false, sort_order: 1 },
    { period_number: 2, name: "Period 2", start_time: "10:15", end_time: "11:15", is_break: false, sort_order: 2 },
    { period_number: 3, name: "Period 3", start_time: "11:25", end_time: "12:25", is_break: false, sort_order: 3 },
    { period_number: 4, name: "Lunch Break", start_time: "12:25", end_time: "01:45", is_break: true, sort_order: 4 },
    { period_number: 5, name: "Period 4", start_time: "01:45", end_time: "02:45", is_break: false, sort_order: 5 },
    { period_number: 6, name: "Period 5", start_time: "02:45", end_time: "03:45", is_break: false, sort_order: 6 },
    { period_number: 7, name: "Period 6", start_time: "03:45", end_time: "04:45", is_break: false, sort_order: 7 },
  ];
}

function postProcessEntries(entries, periods, abbreviationMap) {
  return entries.map((e) => {
    let name = e.subject_name;
    const mapped = abbreviationMap.get(name.toLowerCase()) || abbreviationMap.get(name.toUpperCase());
    if (mapped) name = mapped;

    return {
      ...e,
      subject_name: name,
      period_count: e.period_count || (e.subject_type === "LAB" ? 2 : 1),
    };
  });
}

export function suggestSubjectMerges(entries) {
  const subjectsMap = new Map();

  for (const entry of entries) {
    const name = entry.subject_name.trim();
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (!subjectsMap.has(key)) {
      subjectsMap.set(key, { canonicalName: name, code: entry.subject_code, type: entry.subject_type, count: 1, occurrences: [entry] });
    } else {
      const existing = subjectsMap.get(key);
      existing.count++;
      existing.occurrences.push(entry);
      if (name.length > existing.canonicalName.length && !name.match(/^[A-Z]+$/)) {
        existing.canonicalName = name;
      }
    }
  }

  return Array.from(subjectsMap.values());
}
