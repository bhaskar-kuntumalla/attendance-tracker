-- ============================================================
-- Safe Database Migration: Upgrade to Smart Timetable Attendance Tracker
-- Paste and run this script in Supabase SQL Editor for existing databases.
-- DOES NOT drop existing tables or delete existing attendance records.
-- ============================================================

-- 1. Upgrade PROFILES
alter table if exists public.profiles
  add column if not exists academic_year text;

-- 2. Upgrade SUBJECTS
alter table if exists public.subjects
  add column if not exists subject_code text,
  add column if not exists subject_type text not null default 'THEORY' check (subject_type in ('THEORY', 'LAB', 'TUTORIAL', 'OTHER')),
  add column if not exists target_percentage numeric(5,2) check (target_percentage > 0 and target_percentage <= 100);

-- 3. Create PERIODS table
create table if not exists public.periods (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  period_number integer not null check (period_number >= 0),
  name text not null,
  start_time time not null,
  end_time time not null,
  is_break boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_periods_student on public.periods(student_id);

-- 4. Create TIMETABLE_ENTRIES table
create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  day_of_week text not null check (day_of_week in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  period_id uuid references public.periods(id) on delete set null,
  start_time time,
  end_time time,
  period_count integer not null default 1 check (period_count > 0),
  room text,
  faculty text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_timetable_student on public.timetable_entries(student_id);
create index if not exists idx_timetable_day on public.timetable_entries(student_id, day_of_week);

-- 5. Create TIMETABLE_UPLOADS table
create table if not exists public.timetable_uploads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  file_path text,
  file_type text,
  processing_status text not null default 'completed',
  raw_ocr_text text,
  parsed_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_timetable_uploads_student on public.timetable_uploads(student_id);

-- 6. Upgrade ATTENDANCE
alter table if exists public.attendance
  add column if not exists timetable_entry_id uuid references public.timetable_entries(id) on delete set null,
  add column if not exists notes text;

create index if not exists idx_attendance_entry on public.attendance(timetable_entry_id);

-- Safely update unique constraint to allow multiple sessions per day
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'uq_attendance_student_subject_date'
  ) then
    alter table public.attendance drop constraint uq_attendance_student_subject_date;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_attendance_session'
  ) then
    alter table public.attendance
      add constraint uq_attendance_session unique nulls not distinct (student_id, subject_id, timetable_entry_id, attendance_date);
  end if;
exception when others then
  -- Fallback for PostgreSQL versions prior to 15
  if not exists (
    select 1 from pg_constraint where conname = 'uq_attendance_session'
  ) then
    alter table public.attendance
      add constraint uq_attendance_session unique (student_id, subject_id, timetable_entry_id, attendance_date);
  end if;
end $$;

-- 7. Enable RLS and create security policies
alter table public.periods enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.timetable_uploads enable row level security;

-- periods RLS
drop policy if exists "periods_select_own" on public.periods;
create policy "periods_select_own" on public.periods for select using (auth.uid() = student_id);

drop policy if exists "periods_insert_own" on public.periods;
create policy "periods_insert_own" on public.periods for insert with check (auth.uid() = student_id);

drop policy if exists "periods_update_own" on public.periods;
create policy "periods_update_own" on public.periods for update using (auth.uid() = student_id) with check (auth.uid() = student_id);

drop policy if exists "periods_delete_own" on public.periods;
create policy "periods_delete_own" on public.periods for delete using (auth.uid() = student_id);

-- timetable_entries RLS
drop policy if exists "timetable_select_own" on public.timetable_entries;
create policy "timetable_select_own" on public.timetable_entries for select using (auth.uid() = student_id);

drop policy if exists "timetable_insert_own" on public.timetable_entries;
create policy "timetable_insert_own" on public.timetable_entries for insert with check (auth.uid() = student_id);

drop policy if exists "timetable_update_own" on public.timetable_entries;
create policy "timetable_update_own" on public.timetable_entries for update using (auth.uid() = student_id) with check (auth.uid() = student_id);

drop policy if exists "timetable_delete_own" on public.timetable_entries;
create policy "timetable_delete_own" on public.timetable_entries for delete using (auth.uid() = student_id);

-- timetable_uploads RLS
drop policy if exists "timetable_uploads_select_own" on public.timetable_uploads;
create policy "timetable_uploads_select_own" on public.timetable_uploads for select using (auth.uid() = student_id);

drop policy if exists "timetable_uploads_insert_own" on public.timetable_uploads;
create policy "timetable_uploads_insert_own" on public.timetable_uploads for insert with check (auth.uid() = student_id);

drop policy if exists "timetable_uploads_delete_own" on public.timetable_uploads;
create policy "timetable_uploads_delete_own" on public.timetable_uploads for delete using (auth.uid() = student_id);
