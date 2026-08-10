// ============================================================
// data.js — shared Supabase queries + aggregation
// Every protected page needs "subjects + their attendance periods",
// so that read/aggregate logic lives here once instead of being
// copy-pasted into dashboard.js / subjects.js / analytics.js.
// ============================================================
import { supabase } from "./supabase.js";

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getSubjects(userId) {
  const { data, error } = await supabase
    .from("subjects")
    .select("*")
    .eq("student_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getAllAttendance(userId) {
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("student_id", userId)
    .order("attendance_date", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getAttendanceForDate(userId, dateISO) {
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("student_id", userId)
    .eq("attendance_date", dateISO);
  if (error) throw error;
  return data;
}

// Sums periods for one subject's attendance rows.
// "cancelled" periods are excluded from present/absent/total —
// a cancelled class never happened, so it can't count for or against you.
export function summarize(rows) {
  let present = 0, absent = 0, cancelled = 0;
  for (const r of rows) {
    if (r.status === "present") present += r.periods;
    else if (r.status === "absent") absent += r.periods;
    else if (r.status === "cancelled") cancelled += r.periods;
  }
  return { present, absent, cancelled, total: present + absent };
}

// One efficient round-trip: subjects + all attendance, grouped in JS.
// Returns [{ ...subject, rows, present, absent, cancelled, total }]
export async function getSubjectsWithStats(userId) {
  const [subjects, attendance] = await Promise.all([
    getSubjects(userId),
    getAllAttendance(userId),
  ]);

  const bySubject = new Map();
  for (const row of attendance) {
    if (!bySubject.has(row.subject_id)) bySubject.set(row.subject_id, []);
    bySubject.get(row.subject_id).push(row);
  }

  return subjects.map((s) => {
    const rows = bySubject.get(s.id) || [];
    const stats = summarize(rows);
    return { ...s, rows, ...stats };
  });
}

// Overall totals across all subjects, period-based (never an average of percentages).
export function overallStats(subjectsWithStats) {
  let present = 0, total = 0, absent = 0;
  for (const s of subjectsWithStats) {
    present += s.present;
    absent += s.absent;
    total += s.total;
  }
  return { present, absent, total };
}

/* ---------------- Subjects CRUD ---------------- */

export async function createSubject(userId, { subjectName, subjectCode, subjectType, weeklyPeriods, defaultPeriods, targetPercentage }) {
  const { data, error } = await supabase
    .from("subjects")
    .insert({
      student_id: userId,
      subject_name: subjectName,
      subject_code: subjectCode || null,
      subject_type: subjectType || "THEORY",
      weekly_periods: weeklyPeriods || 1,
      default_periods: defaultPeriods || 1,
      target_percentage: targetPercentage || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSubject(subjectId, updates) {
  const { data, error } = await supabase
    .from("subjects")
    .update(updates)
    .eq("id", subjectId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSubject(subjectId) {
  const { error } = await supabase.from("subjects").delete().eq("id", subjectId);
  if (error) throw error;
}

/* ---------------- Periods CRUD ---------------- */

export async function getPeriods(userId) {
  const { data, error } = await supabase
    .from("periods")
    .select("*")
    .eq("student_id", userId)
    .order("sort_order", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw error;
  return data;
}

export async function savePeriods(userId, periodsList) {
  // Replace user's periods
  const { error: delError } = await supabase.from("periods").delete().eq("student_id", userId);
  if (delError) throw delError;

  if (!periodsList || !periodsList.length) return [];

  const rows = periodsList.map((p, idx) => ({
    student_id: userId,
    period_number: p.period_number || idx + 1,
    name: p.name || `Period ${idx + 1}`,
    start_time: p.start_time || "09:00",
    end_time: p.end_time || "10:00",
    is_break: !!p.is_break,
    sort_order: idx + 1,
  }));

  const { data, error } = await supabase
    .from("periods")
    .insert(rows)
    .select();
  if (error) throw error;
  return data;
}

/* ---------------- Timetable Entries CRUD ---------------- */

export async function getTimetableEntries(userId) {
  const { data, error } = await supabase
    .from("timetable_entries")
    .select(`
      *,
      subject:subjects(*)
    `)
    .eq("student_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function saveTimetableData(userId, { periods, subjects, entries }) {
  // 1. Save / Update Periods
  let savedPeriods = await savePeriods(userId, periods);
  const periodMap = new Map();
  for (const p of savedPeriods) {
    periodMap.set(p.period_number, p.id);
  }

  // 2. Ensure / Create Unique Subjects
  const existingSubjects = await getSubjects(userId);
  const existingMap = new Map();
  for (const s of existingSubjects) {
    existingMap.set(s.subject_name.toLowerCase().trim(), s);
  }

  const finalSubjectMap = new Map();

  for (const sub of subjects) {
    const key = sub.subject_name.toLowerCase().trim();
    if (existingMap.has(key)) {
      const match = existingMap.get(key);
      // Update weekly periods if greater
      if (sub.weekly_periods && sub.weekly_periods > match.weekly_periods) {
        await updateSubject(match.id, { weekly_periods: sub.weekly_periods });
      }
      finalSubjectMap.set(key, match.id);
    } else {
      const created = await createSubject(userId, {
        subjectName: sub.subject_name.trim(),
        subjectCode: sub.subject_code || null,
        subjectType: sub.subject_type || "THEORY",
        weeklyPeriods: sub.weekly_periods || 1,
        defaultPeriods: sub.subject_type === "LAB" ? 2 : 1,
      });
      finalSubjectMap.set(key, created.id);
    }
  }

  // 3. Save Timetable Entries (clearing previous entries to apply clean version)
  const { error: delErr } = await supabase
    .from("timetable_entries")
    .delete()
    .eq("student_id", userId);
  if (delErr) throw delErr;

  const timetableRows = entries.map((e) => {
    const key = e.subject_name.toLowerCase().trim();
    const subjectId = finalSubjectMap.get(key) || null;
    const periodId = periodMap.get(e.period_number) || null;

    return {
      student_id: userId,
      subject_id: subjectId,
      day_of_week: e.day_of_week,
      period_id: periodId,
      start_time: e.start_time || "09:00",
      end_time: e.end_time || "10:00",
      period_count: e.period_count || (e.subject_type === "LAB" ? 2 : 1),
      room: e.room || null,
      faculty: e.faculty || null,
    };
  });

  const { data: savedEntries, error: saveErr } = await supabase
    .from("timetable_entries")
    .insert(timetableRows)
    .select();
  if (saveErr) throw saveErr;

  return savedEntries;
}

export async function clearTimetable(userId) {
  const { error } = await supabase
    .from("timetable_entries")
    .delete()
    .eq("student_id", userId);
  if (error) throw error;
}

/* ---------------- Timetable Uploads CRUD ---------------- */

export async function saveTimetableUpload(userId, { filePath, fileType, rawText, parsedData }) {
  const { data, error } = await supabase
    .from("timetable_uploads")
    .insert({
      student_id: userId,
      file_path: filePath || null,
      file_type: fileType || "image/png",
      raw_ocr_text: rawText || null,
      parsed_data: parsedData || null,
      processing_status: "completed",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ---------------- Today's Classes & Session-Aware Attendance ---------------- */

export async function getTodayClasses(userId, dayName) {
  const [entries, subjects] = await Promise.all([
    getTimetableEntries(userId),
    getSubjects(userId),
  ]);

  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  // Filter entries for specified day
  const todayEntries = entries
    .filter((e) => e.day_of_week.toLowerCase() === dayName.toLowerCase())
    .map((e) => ({
      ...e,
      subject: subjectMap.get(e.subject_id) || e.subject || { subject_name: "Unknown Subject" },
    }));

  // Sort by start_time
  todayEntries.sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));

  return todayEntries;
}

/* ---------------- Attendance CRUD (upsert-style) ---------------- */

export async function markAttendance(userId, { subjectId, date, status, periods, timetableEntryId = null, notes = null }) {
  const payload = {
    student_id: userId,
    subject_id: subjectId,
    attendance_date: date,
    status,
    periods,
    timetable_entry_id: timetableEntryId || null,
    notes: notes || null,
    updated_at: new Date().toISOString(),
  };

  // Check if an existing record exists for this specific session
  let matchQuery = supabase
    .from("attendance")
    .select("id")
    .eq("student_id", userId)
    .eq("subject_id", subjectId)
    .eq("attendance_date", date);

  if (timetableEntryId) {
    matchQuery = matchQuery.eq("timetable_entry_id", timetableEntryId);
  } else {
    matchQuery = matchQuery.is("timetable_entry_id", null);
  }

  const { data: existing } = await matchQuery.maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("attendance")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from("attendance")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

export async function deleteAttendanceRecord(id) {
  const { error } = await supabase.from("attendance").delete().eq("id", id);
  if (error) throw error;
}
