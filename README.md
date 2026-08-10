# Attendance Tracker

A student attendance tracker. Pure **HTML5 + CSS3 + vanilla JavaScript** on the frontend,
**Supabase** (Postgres + Auth) as the only backend. No React, no Node server, no Express —
it's a static site you can host anywhere.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New Project**.
2. Pick a name, a database password (save it somewhere), and a region.
3. Wait for the project to finish provisioning (~2 minutes).

## 2. Run the SQL

1. In the Supabase dashboard, open **SQL Editor → New Query**.
2. Paste the entire contents of [`sql/schema.sql`](sql/schema.sql).
3. Click **Run**. This creates `profiles`, `subjects`, `attendance`, the auto-profile
   trigger, indexes, and all Row Level Security policies.

## 3–4. Configure the Supabase URL + anon key

1. In Supabase: **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key (never the `service_role` key).
3. Open `js/supabase.js` and replace the two placeholders:

```js
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

## 5. Enable email authentication

1. **Authentication → Providers → Email** → make sure it's enabled.
2. If you don't want the "confirm your email" step while testing, go to
   **Authentication → Settings** and turn off "Confirm email" (turn it back on before
   sharing the app with real students).

## 6. Run locally

This is a static site — any local file server works:

```bash
# from the project folder
npx serve .
# or
python3 -m http.server 5500
```

Then open `http://localhost:5500` (or whatever port it prints). Opening `index.html`
directly via `file://` will NOT work — ES modules require an HTTP server.

## 7. Deploy to Vercel / Netlify / GitHub Pages

**Vercel / Netlify:** drag-and-drop the project folder into the dashboard, or connect
the GitHub repo. No build command needed — it's static HTML. Output/publish directory: `/`.

**GitHub Pages:** push this folder to a repo, then **Settings → Pages → Deploy from branch**
→ select the branch and `/ (root)`.

## 8. Configure production URL (Supabase auth redirect)

In Supabase: **Authentication → URL Configuration**, set **Site URL** to your deployed
domain (e.g. `https://your-app.vercel.app`) so auth emails/redirects point to the right place.

## 9. Test authentication

1. Open `signup.html`, create an account.
2. Confirm you land on `dashboard.html` (or check your email if confirmation is on).
3. Log out from the sidebar/profile page, then log back in via `login.html`.
4. Try visiting `dashboard.html` directly while logged out — it should redirect to `login.html`.

## 10. Test attendance

1. Go to **Subjects** → add a subject (e.g. "DBMS", weekly periods 4, default periods 1).
2. Go to **Attendance** → mark it Present or Absent for today → **Save Attendance**.
3. Reload the page for the same date — your selection should still be there (no duplicate row).
4. Check **Dashboard** and **Analytics** to see the percentage update.

---

## Project structure

```
attendance-tracker/
├── index.html          redirects to dashboard or login based on session
├── login.html
├── signup.html
├── dashboard.html
├── subjects.html
├── attendance.html      the "mark in a few seconds" page
├── analytics.html        overview / simulator / history / absences tabs
├── profile.html
├── css/
│   ├── style.css        design tokens + shared layout/components
│   ├── auth.css
│   ├── dashboard.css
│   ├── subjects.css
│   ├── attendance.css
│   ├── analytics.css
│   ├── profile.css
│   └── responsive.css
├── js/
│   ├── supabase.js      client init — put your URL + anon key here
│   ├── data.js           all Supabase queries + CRUD + aggregation
│   ├── nav.js             injects the sidebar/topbar/bottom-nav shell
│   ├── auth.js
│   ├── dashboard.js
│   ├── subjects.js
│   ├── attendance.js
│   ├── analytics.js
│   ├── profile.js
│   └── utils.js          attendance math, formatting, toasts, auth guard
└── sql/
    └── schema.sql        tables, constraints, indexes, RLS, trigger
```

## How the numbers work

- Everything is calculated in **periods**, not row counts — a 3-period lab counts as 3.
- `attendance_percentage = present_periods / total_periods × 100`, rounded to 1 decimal.
  `cancelled` periods are excluded from both present and total (a cancelled class never happened).
- **Overall attendance** sums periods across all subjects first, then divides — never an
  average of each subject's percentage.
- **"Periods needed to reach target"** and **"periods you can miss"** are solved
  algebraically (see `periodsToReachTarget` / `periodsCanMiss` in `js/utils.js`), not estimated.

## Security

Row Level Security is enabled on `profiles`, `subjects`, and `attendance`. Every policy
checks `auth.uid()`, so one student can never read or write another student's data — this
is enforced by Postgres itself, not just hidden in the UI. Only the anon key ever touches
the frontend; the service_role key is never used here.
