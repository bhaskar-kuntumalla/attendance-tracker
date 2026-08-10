-- ============================================================
-- Attendance Tracker — Supabase Master Schema (Timetable Enabled)
-- Paste this entire file into Supabase Dashboard → SQL Editor → New Query → Run
-- Safe to run once on a fresh project or after running migration_timetable.sql.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  roll_number text not null,
  email text not null,
  semester text,
  academic_year text,
  attendance_target numeric(5,2) not null default 75.00
    check (attendance_target > 0 and attendance_target <= 100),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. SUBJECTS
-- ------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject_name text not null check (char_length(trim(subject_name)) > 0),
  subject_code text,
  subject_type text not null default 'THEORY'
    check (subject_type in ('THEORY', 'LAB', 'TUTORIAL', 'OTHER')),
  weekly_periods integer not null default 1 check (weekly_periods > 0),
  default_periods integer not null default 1 check (default_periods > 0),
  target_percentage numeric(5,2) check (target_percentage > 0 and target_percentage <= 100),
  created_at timestamptz not null default now()
);

create index if not exists idx_subjects_student on public.subjects(student_id);

-- ------------------------------------------------------------
-- 3. PERIODS (Custom College Period Timings)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 4. TIMETABLE ENTRIES
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 5. TIMETABLE UPLOADS
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 6. ATTENDANCE
-- ------------------------------------------------------------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  timetable_entry_id uuid references public.timetable_entries(id) on delete set null,
  attendance_date date not null,
  status text not null check (status in ('present', 'absent', 'cancelled')),
  periods integer not null default 1 check (periods > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unique constraint allowing multiple sessions per day when timetable_entry_id differs
  constraint uq_attendance_session unique nulls not distinct (student_id, subject_id, timetable_entry_id, attendance_date)
);

create index if not exists idx_attendance_student on public.attendance(student_id);
create index if not exists idx_attendance_subject on public.attendance(subject_id);
create index if not exists idx_attendance_date on public.attendance(attendance_date);
create index if not exists idx_attendance_entry on public.attendance(timetable_entry_id);

-- ------------------------------------------------------------
-- 7. AUTO-CREATE PROFILE ON SIGNUP
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, roll_number, email, semester, attendance_target)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'roll_number', ''),
    new.email,
    new.raw_user_meta_data->>'semester',
    coalesce((new.raw_user_meta_data->>'attendance_target')::numeric, 75.00)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.periods enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.timetable_uploads enable row level security;
alter table public.attendance enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

-- subjects
drop policy if exists "subjects_select_own" on public.subjects;
create policy "subjects_select_own" on public.subjects for select using (auth.uid() = student_id);

drop policy if exists "subjects_insert_own" on public.subjects;
create policy "subjects_insert_own" on public.subjects for insert with check (auth.uid() = student_id);

drop policy if exists "subjects_update_own" on public.subjects;
create policy "subjects_update_own" on public.subjects for update using (auth.uid() = student_id) with check (auth.uid() = student_id);

drop policy if exists "subjects_delete_own" on public.subjects;
create policy "subjects_delete_own" on public.subjects for delete using (auth.uid() = student_id);

-- periods
drop policy if exists "periods_select_own" on public.periods;
create policy "periods_select_own" on public.periods for select using (auth.uid() = student_id);

drop policy if exists "periods_insert_own" on public.periods;
create policy "periods_insert_own" on public.periods for insert with check (auth.uid() = student_id);

drop policy if exists "periods_update_own" on public.periods;
create policy "periods_update_own" on public.periods for update using (auth.uid() = student_id) with check (auth.uid() = student_id);

drop policy if exists "periods_delete_own" on public.periods;
create policy "periods_delete_own" on public.periods for delete using (auth.uid() = student_id);

-- timetable_entries
drop policy if exists "timetable_select_own" on public.timetable_entries;
create policy "timetable_select_own" on public.timetable_entries for select using (auth.uid() = student_id);

drop policy if exists "timetable_insert_own" on public.timetable_entries;
create policy "timetable_insert_own" on public.timetable_entries for insert with check (auth.uid() = student_id);

drop policy if exists "timetable_update_own" on public.timetable_entries;
create policy "timetable_update_own" on public.timetable_entries for update using (auth.uid() = student_id) with check (auth.uid() = student_id);

drop policy if exists "timetable_delete_own" on public.timetable_entries;
create policy "timetable_delete_own" on public.timetable_entries for delete using (auth.uid() = student_id);

-- timetable_uploads
drop policy if exists "timetable_uploads_select_own" on public.timetable_uploads;
create policy "timetable_uploads_select_own" on public.timetable_uploads for select using (auth.uid() = student_id);

drop policy if exists "timetable_uploads_insert_own" on public.timetable_uploads;
create policy "timetable_uploads_insert_own" on public.timetable_uploads for insert with check (auth.uid() = student_id);

drop policy if exists "timetable_uploads_delete_own" on public.timetable_uploads;
create policy "timetable_uploads_delete_own" on public.timetable_uploads for delete using (auth.uid() = student_id);

-- attendance
drop policy if exists "attendance_select_own" on public.attendance;
create policy "attendance_select_own" on public.attendance for select using (auth.uid() = student_id);

drop policy if exists "attendance_insert_own" on public.attendance;
create policy "attendance_insert_own" on public.attendance for insert with check (auth.uid() = student_id);

drop policy if exists "attendance_update_own" on public.attendance;
create policy "attendance_update_own" on public.attendance for update using (auth.uid() = student_id) with check (auth.uid() = student_id);

drop policy if exists "attendance_delete_own" on public.attendance;
create policy "attendance_delete_own" on public.attendance for delete using (auth.uid() = student_id);
