// ============================================================
// table-detector.js — HTML5 Canvas Line Density & Grid Boundary Reconstruction Engine
// Detects visual table grid lines, row boundaries, period column boundaries,
// merged cell spans via line continuity confidence scoring, and lunch break dividers.
// ============================================================

export async function detectImageTableGrid(imageBlob, words = []) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(imageBlob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      // 1. Binarize image (1 = dark pixel, 0 = light background)
      const binary = new Uint8Array(width * height);
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const idx = i / 4;
        binary[idx] = gray < 140 ? 1 : 0;
      }

      // 2. Locate Main Timetable Bounding Box
      const tableRegion = findMainTableRegion(words, width, height);

      // 3. Detect Main Period Column X Boundaries
      const periodColumns = detectPeriodColumns(words, tableRegion, width);

      // 4. Detect Day Row Y Boundaries
      const dayRows = detectDayRows(words, tableRegion, height);

      // 5. Reconstruct Row-Specific Visual Grid Cells with Line Confidence Scoring
      const gridCells = reconstructRowCellsWithConfidence(binary, width, height, dayRows, periodColumns);

      resolve({
        tableRegion,
        periodColumns,
        dayRows,
        gridCells,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(fallbackGrid(words));
    };

    img.src = url;
  });
}

/* ---------------- 1. Locate Main Timetable Region ---------------- */

function findMainTableRegion(words, width, height) {
  let minY = Math.round(height * 0.15);
  let maxY = Math.round(height * 0.70);
  let minX = Math.round(width * 0.05);
  let maxX = Math.round(width * 0.95);

  const dayTimeWord = words.find((w) => /day|time|period|p1/i.test(w.text) && w.cy < height * 0.4);
  if (dayTimeWord) minY = Math.max(0, dayTimeWord.y0 - 25);

  const satWord = words.find((w) => /sat|saturday/i.test(w.text));
  if (satWord) maxY = Math.min(height, satWord.y1 + 80);

  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/* ---------------- 2. Period Column Bounds Detection ---------------- */

function detectPeriodColumns(words, tableRegion, imgWidth) {
  const defaultSlots = [
    { start_time: "09:15", end_time: "10:15", period_number: 1 },
    { start_time: "10:15", end_time: "11:15", period_number: 2 },
    { start_time: "11:25", end_time: "12:25", period_number: 3 },
    { start_time: "12:25", end_time: "01:45", period_number: 4, is_break: true },
    { start_time: "01:45", end_time: "02:45", period_number: 5 },
    { start_time: "02:45", end_time: "03:45", period_number: 6 },
    { start_time: "03:45", end_time: "04:45", period_number: 7 },
  ];

  const headerWords = words.filter(
    (w) => w.cy >= tableRegion.minY - 30 && w.cy <= tableRegion.minY + 90
  );

  const timeHeaderWords = headerWords.filter(
    (w) => /\b(\d{1,2}[:.]\d{2}|p\d+|lunch|break)\b/i.test(w.text)
  ).sort((a, b) => a.cx - b.cx);

  if (timeHeaderWords.length >= 4) {
    const cols = [];
    let pNum = 1;

    for (let i = 0; i < timeHeaderWords.length; i++) {
      const w = timeHeaderWords[i];
      const isBreak = /lunch|break/i.test(w.text);
      const slot = defaultSlots[pNum - 1] || defaultSlots[0];

      cols.push({
        period_number: pNum++,
        is_break: isBreak,
        name: isBreak ? "Lunch Break" : `Period ${pNum - 1}`,
        start_time: slot.start_time,
        end_time: slot.end_time,
        x0: w.x0 - 15,
        x1: w.x1 + 35,
        cx: w.cx,
      });
    }
    return cols;
  }

  // Spatial equal division fallback
  const dayColWidth = Math.round(tableRegion.width * 0.12);
  const startX = tableRegion.minX + dayColWidth;
  const remWidth = tableRegion.maxX - startX;
  const colWidth = remWidth / defaultSlots.length;

  return defaultSlots.map((slot, idx) => {
    const x0 = Math.round(startX + idx * colWidth);
    const x1 = Math.round(startX + (idx + 1) * colWidth);
    return {
      ...slot,
      is_break: !!slot.is_break,
      name: slot.is_break ? "Lunch Break" : `Period ${idx + 1}`,
      x0,
      x1,
      cx: (x0 + x1) / 2,
    };
  });
}

/* ---------------- 3. Day Rows Bounds Detection ---------------- */

function detectDayRows(words, tableRegion, imgHeight) {
  const daysOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayWords = words.filter(
    (w) => /\b(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday)\b/i.test(w.text) && w.cy >= tableRegion.minY
  );

  const dayRows = [];

  for (const dayName of daysOrder) {
    const match = dayWords.find((w) => w.text.toLowerCase().startsWith(dayName.slice(0, 3).toLowerCase()));
    if (match) {
      dayRows.push({
        canonicalDay: dayName,
        y0: match.y0 - 10,
        y1: match.y1 + 18,
        cy: match.cy,
        x1: match.x1,
      });
    }
  }

  dayRows.sort((a, b) => a.cy - b.cy);

  if (dayRows.length === 0) {
    const rowHeight = (tableRegion.maxY - tableRegion.minY) / daysOrder.length;
    return daysOrder.map((dayName, idx) => {
      const y0 = Math.round(tableRegion.minY + idx * rowHeight);
      const y1 = Math.round(tableRegion.minY + (idx + 1) * rowHeight);
      return {
        canonicalDay: dayName,
        y0,
        y1,
        cy: (y0 + y1) / 2,
        x1: tableRegion.minX + 120,
      };
    });
  }

  return dayRows;
}

/* ---------------- 4. Line Confidence Scoring & Cell Reconstruction ---------------- */

function reconstructRowCellsWithConfidence(binary, imgWidth, imgHeight, dayRows, periodColumns) {
  const gridCells = [];
  const classColumns = periodColumns.filter((c) => !c.is_break);

  for (const row of dayRows) {
    let pIdx = 0;

    while (pIdx < classColumns.length) {
      const startCol = classColumns[pIdx];
      let span = 1;
      let needsReview = false;

      for (let nextIdx = pIdx + 1; nextIdx < classColumns.length; nextIdx++) {
        const nextCol = classColumns[nextIdx];
        const lineBoundaryX = Math.round((classColumns[nextIdx - 1].x1 + nextCol.x0) / 2);

        const lineConfidence = calculateVerticalLineConfidence(binary, imgWidth, lineBoundaryX, row.y0, row.y1);

        if (lineConfidence > 0.60) {
          // Line present -> separate cell
          break;
        } else if (lineConfidence < 0.30) {
          // Line absent -> merged cell
          span++;
        } else {
          // Ambiguous line -> merge candidate but flag needsReview
          needsReview = true;
          span++;
        }
      }

      const endCol = classColumns[pIdx + span - 1];

      gridCells.push({
        day_of_week: row.canonicalDay,
        startPeriod: startCol.period_number,
        endPeriod: endCol.period_number,
        periodCount: span,
        needsReview,
        confidence: needsReview ? "ambiguous" : "high",
        bbox: {
          x0: startCol.x0,
          y0: row.y0,
          x1: endCol.x1,
          y1: row.y1,
        },
      });

      pIdx += span;
    }
  }

  return gridCells;
}

function calculateVerticalLineConfidence(binary, imgWidth, targetX, y0, y1) {
  const rowHeight = y1 - y0;
  if (rowHeight <= 0) return 0;

  let darkPixelCount = 0;
  const searchRadius = 2;

  for (let y = y0; y <= y1; y++) {
    let foundDark = false;
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      const x = targetX + dx;
      if (x >= 0 && x < imgWidth) {
        const idx = y * imgWidth + x;
        if (binary[idx] === 1) {
          foundDark = true;
          break;
        }
      }
    }
    if (foundDark) darkPixelCount++;
  }

  return darkPixelCount / rowHeight;
}

function fallbackGrid(words) {
  return {
    tableRegion: { minX: 100, maxX: 1000, minY: 150, maxY: 700, width: 900, height: 550 },
    periodColumns: [],
    dayRows: [],
    gridCells: [],
  };
}
