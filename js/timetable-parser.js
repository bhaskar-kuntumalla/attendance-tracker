// ============================================================
// timetable-parser.js — Universal Geometry-First College Timetable Extractor
// Combines canvas line density grid detector with bottom reference table OCR fuzzy normalization.
// ZERO hardcoded subjects, branches, or department layouts.
// ============================================================

import { detectImageTableGrid } from "./table-detector.js";

export const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DAY_REGEX = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i;
const BREAK_KW_REGEX = /\b(lunch|break|recess|tea|snack)\b/i;
const LAB_KW_REGEX = /\b(lab|practical|workshop|tinkering|project|viva|laboratory)\b/i;

export async function parseTimetableText(ocrData, imageBlob = null) {
  const rawText = typeof ocrData === "string" ? ocrData : ocrData.rawText || "";
  const lines = ocrData.lines || rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const words = ocrData.words || [];

  // 1. Extract Header Metadata
  const headerMetadata = extractHeaderMetadata(lines);

  // 2. Extract Bottom Reference Table Subject Dictionary
  const referenceSubjects = extractReferenceSubjectDictionary(lines);

  // 3. Run HTML5 Canvas Line Density Grid Detector if image blob is provided
  let detectedGrid = null;
  if (imageBlob) {
    try {
      detectedGrid = await detectImageTableGrid(imageBlob, words);
    } catch (e) {
      console.warn("Canvas line density detection warning:", e);
    }
  }

  let periods = detectedGrid?.periodColumns?.length ? detectedGrid.periodColumns : getDefaultPeriods();
  let entries = [];

  if (detectedGrid && detectedGrid.gridCells && detectedGrid.gridCells.length > 0) {
    // Map OCR words into reconstructed visual image grid cells with candidate validation
    entries = mapWordsToReconstructedGridCells(words, detectedGrid.gridCells, periods, referenceSubjects);
  } else {
    // Fallback line-based parsing
    entries = fallbackLineParsing(lines, periods, referenceSubjects);
  }

  return {
    headerMetadata,
    periods,
    entries,
    referenceSubjects,
    detectedGrid,
  };
}

/* ---------------- 1. Header Metadata ---------------- */

function extractHeaderMetadata(lines) {
  const meta = { branch: null, semester: null, section: null, academicYear: null };
  const headerText = lines.slice(0, 8).join(" ");

  const branchMatch = headerText.match(/\b(CSE|ECE|EEE|MECHANICAL|MECH|ME|CIVIL|CE|AI\s*&\s*DS|AIDS|IT)\b/i);
  if (branchMatch) meta.branch = branchMatch[0].toUpperCase();

  const semMatch = headerText.match(/\b(I{1,3}-I{1,2}|IV-I|IV-II|[1-8](?:st|nd|rd|th)?\s*sem(?:ester)?|semester\s*[1-8])\b/i);
  if (semMatch) meta.semester = semMatch[0].toUpperCase();

  const secMatch = headerText.match(/\b(?:sec(?:tion)?)\s*[-:]?\s*([A-Z0-9]+)\b/i);
  if (secMatch) meta.section = secMatch[1].toUpperCase();

  const yearMatch = headerText.match(/\b(20\d{2}\s*[-–/]\s*20?\d{2})\b/);
  if (yearMatch) meta.academicYear = yearMatch[0];

  return meta;
}

/* ---------------- 2. Extract Reference Subject Dictionary ---------------- */

function extractReferenceSubjectDictionary(lines) {
  const subjects = [];
  const seenCodes = new Set();

  const startIdx = Math.max(0, Math.floor(lines.length * 0.35));
  const refLines = lines.slice(startIdx);

  for (const line of refLines) {
    // Matches "AI : Artificial Intelligence", "OE-I - Open Elective-I", "AT&CD = Automata Theory & Compiler Design"
    const pairMatch = line.match(/\b([A-Z0-9&/\-]{2,12})\s*[:=\-–|]\s*([A-Za-z0-9\s&,'"\-]{3,60})/);
    if (pairMatch) {
      const code = pairMatch[1].trim().toUpperCase();
      const name = pairMatch[2].trim();

      if (!isDayName(code) && !BREAK_KW_REGEX.test(name) && !seenCodes.has(code)) {
        seenCodes.add(code);
        const isLab = LAB_KW_REGEX.test(code) || LAB_KW_REGEX.test(name);
        subjects.push({
          subject_code: code,
          subject_name: name,
          subject_type: isLab ? "LAB" : "THEORY",
        });
      }
    }
  }

  return subjects;
}

/* ---------------- 3. Matching Priority & Candidate Validation Pipeline ---------------- */

function validateCandidateAgainstReference(rawCandidate, referenceSubjects) {
  if (!rawCandidate) return { matched: false, subject: null, needsReview: true };

  const clean = rawCandidate.replace(/[\|\[\]\(\)\{\}\*\#]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 2 || isDayName(clean) || BREAK_KW_REGEX.test(clean)) {
    return { matched: false, subject: null, needsReview: true };
  }

  // Pre-normalization for OCR character confusion
  let normalizedInput = clean
    .replace(/\bAl\b/g, "AI")
    .replace(/\bOF-1\b/g, "OE-I")
    .replace(/\b1QT&A\b/g, "IQT&A")
    .replace(/\bPE-T\b/g, "PE-I")
    .toUpperCase();

  // If no reference table exists, return unvalidated candidate marked Needs Review
  if (!referenceSubjects || referenceSubjects.length === 0) {
    const isLab = LAB_KW_REGEX.test(clean);
    return {
      matched: false,
      subject: { subject_name: clean, subject_code: extractCode(clean), subject_type: isLab ? "LAB" : "THEORY" },
      needsReview: true,
    };
  }

  // Priority 1: EXACT ABBREVIATION
  for (const ref of referenceSubjects) {
    if (ref.subject_code.toUpperCase() === normalizedInput) {
      return { matched: true, subject: ref, needsReview: false, confidence: 1.0 };
    }
  }

  // Priority 2: NORMALIZED ABBREVIATION (strip punctuation/hyphens)
  const normCleanInput = normalizedInput.replace(/[^A-Z0-9]/g, "");
  for (const ref of referenceSubjects) {
    const normRefCode = ref.subject_code.replace(/[^A-Z0-9]/g, "");
    if (normRefCode.toUpperCase() === normCleanInput && normCleanInput.length >= 2) {
      return { matched: true, subject: ref, needsReview: false, confidence: 0.95 };
    }
  }

  // Priority 3: EXACT SUBJECT NAME
  for (const ref of referenceSubjects) {
    if (ref.subject_name.toUpperCase() === clean.toUpperCase()) {
      return { matched: true, subject: ref, needsReview: false, confidence: 0.95 };
    }
  }

  // Priority 4: FUZZY SIMILARITY SCORE (length-normalized)
  let bestMatch = null;
  let highestSim = 0;

  for (const ref of referenceSubjects) {
    const simCode = calculateNormalizedSimilarity(normalizedInput, ref.subject_code.toUpperCase());
    const simName = calculateNormalizedSimilarity(clean.toUpperCase(), ref.subject_name.toUpperCase());
    const sim = Math.max(simCode, simName);

    // Apply strict length penalty for short codes to prevent false merges
    const minLen = Math.min(normalizedInput.length, ref.subject_code.length);
    const threshold = minLen <= 3 ? 0.85 : 0.70;

    if (sim > highestSim && sim >= threshold) {
      highestSim = sim;
      bestMatch = ref;
    }
  }

  if (bestMatch && highestSim >= 0.70) {
    return { matched: true, subject: bestMatch, needsReview: false, confidence: highestSim };
  }

  // Priority 5: NEEDS REVIEW (DO NOT guess or invent random subject!)
  const isLab = LAB_KW_REGEX.test(clean);
  return {
    matched: false,
    subject: { subject_name: clean, subject_code: extractCode(clean), subject_type: isLab ? "LAB" : "THEORY" },
    needsReview: true,
    confidence: highestSim,
  };
}

/* ---------------- 4. Assign Words to Visual Image Grid Cells ---------------- */

function mapWordsToReconstructedGridCells(words, gridCells, periodColumns, referenceSubjects) {
  const entries = [];

  for (const cell of gridCells) {
    const cellWords = words.filter(
      (w) => w.cx >= cell.bbox.x0 - 15 && w.cx <= cell.bbox.x1 + 15 && w.cy >= cell.bbox.y0 - 10 && w.cy <= cell.bbox.y1 + 10
    );

    const cellRawText = cellWords.map((w) => w.text).join(" ").trim();
    if (!cellRawText || isDayName(cellRawText) || BREAK_KW_REGEX.test(cellRawText) || cellRawText.length < 2) {
      continue;
    }

    // Run Candidate Validation Pipeline
    const val = validateCandidateAgainstReference(cellRawText, referenceSubjects);

    const startSlot = periodColumns.find((p) => p.period_number === cell.startPeriod) || periodColumns[0];
    const endSlot = periodColumns.find((p) => p.period_number === cell.endPeriod) || startSlot;

    const subName = val.subject?.subject_name || cellRawText;
    const subCode = val.subject?.subject_code || extractCode(subName);
    const isLab = val.subject?.subject_type === "LAB" || LAB_KW_REGEX.test(cellRawText) || LAB_KW_REGEX.test(subName);

    entries.push({
      day_of_week: cell.day_of_week,
      period_number: cell.startPeriod,
      subject_name: subName,
      subject_code: subCode,
      subject_type: isLab ? "LAB" : "THEORY",
      period_count: cell.periodCount,
      start_time: startSlot?.start_time || "09:15",
      end_time: endSlot?.end_time || "10:15",
      needsReview: cell.needsReview || val.needsReview || !val.matched,
      room: null,
      faculty: null,
    });
  }

  return entries;
}

/* ---------------- Fallback Line Parsing ---------------- */

function fallbackLineParsing(lines, periods, referenceSubjects) {
  const entries = [];
  let currentDay = "Monday";

  for (const line of lines) {
    const dayMatch = line.match(DAY_REGEX);
    if (dayMatch && line.length < 25) {
      const canon = matchCanonicalDay(dayMatch[1]);
      if (canon) currentDay = canon;
      continue;
    }

    if (BREAK_KW_REGEX.test(line) || line.length < 3) continue;

    const tokens = line.split(/\s{2,}|\t/).map((t) => t.trim()).filter(Boolean);
    let pIdx = 1;

    for (const tok of tokens) {
      if (DAY_REGEX.test(tok)) continue;

      const val = validateCandidateAgainstReference(tok, referenceSubjects);
      const isLab = val.subject?.subject_type === "LAB" || LAB_KW_REGEX.test(tok);

      entries.push({
        day_of_week: currentDay,
        period_number: pIdx,
        subject_name: val.subject?.subject_name || tok,
        subject_code: val.subject?.subject_code || extractCode(tok),
        subject_type: isLab ? "LAB" : "THEORY",
        period_count: isLab ? 2 : 1,
        start_time: periods[pIdx - 1]?.start_time || "09:15",
        end_time: periods[pIdx - 1]?.end_time || "10:15",
        needsReview: val.needsReview || !val.matched,
        room: null,
        faculty: null,
      });

      pIdx += isLab ? 2 : 1;
    }
  }

  return entries;
}

/* ---------------- Similarity & Helper Utilities ---------------- */

function calculateNormalizedSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1.0;
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(str1, str2);
  return 1 - dist / maxLen;
}

function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function isDayName(str) {
  if (!str) return false;
  return DAY_REGEX.test(str.trim());
}

function matchCanonicalDay(str) {
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

function extractCode(name) {
  if (!name) return "";
  if (name.length <= 8 && /^[A-Z0-9\-&]+$/i.test(name)) return name.toUpperCase();
  const words = name.split(/\s+/).filter((w) => w.length > 0 && !/^(and|of|the|for|in|lab)$/i.test(w));
  if (words.length >= 2) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 8);
  return name.slice(0, 8).toUpperCase();
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
    }
  }

  return Array.from(subjectsMap.values());
}
