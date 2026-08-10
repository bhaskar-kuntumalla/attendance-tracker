// ============================================================
// Supabase configuration
// Replace the two values below with your project's credentials.
// Supabase Dashboard → Project Settings → API
// ============================================================

const SUPABASE_URL = "https://qhmdlprsbjkyjpgjxacy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Z8qj5QECz-iokOYImqQLQQ_fgMEsbh_";// the "anon / public" key ONLY

// Never put the service_role key here — this file is public frontend code.

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const DEFAULT_ATTENDANCE_TARGET = 75;
