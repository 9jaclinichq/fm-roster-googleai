# FM Residents Dashboard

FM Residents Dashboard is a production-grade, highly responsive monthly information collection system built for the **Department of Family Medicine**. It is designed to coordinate monthly resident rotations, track leave statuses, and collect supporting documents through an integrated administrative dashboard for scheduling managers (Chief Residents).

The application is built with **React 18+**, **Vite**, **TypeScript**, and **Tailwind CSS**, and is fully connected to **Supabase** for database, RLS security, and storage capabilities.

---

## 🚀 Key Features

### 👤 Resident Portal
- **Lightweight Access**: Residents select their name from the active workforce registry and enter their personal 6-digit access code.
- **Dynamic Postings Form**: Submit current rotation, upcoming rotation, and leave parameters for the roster month.
- **Leave Management**: Toggling leave supports custom types, date range validation, and uploading up to 3 files (PDF, JPEG, JPG, PNG up to 5MB) via drag-and-drop or browsing.
- **Read-Only Lock**: Submission details are automatically locked once the collection cycle deadline passes or is explicitly closed by the Chief Resident.

### 👑 Chief Resident Dashboard
- **Live Statistics (Supabase DQL)**: Counts Total Active Workforce, Completed Submissions, and Pending Submissions for the current collection.
- **Administrative Override**: Create, update, or edit a resident's roster/rotation entry on their behalf in real-time.
- **Outreach & Access Control**: View active resident access codes to assist with resident login, or reset codes to new random 6-digit values instantly.
- **Report Exports**: Download a standardized CSV spreadsheet of all submissions with a single click.
- **Cycle Control**: Open new monthly duty rosters, adjust active deadlines, and update the administrative entry password.

---

## 🛠️ Supabase Configuration & Migration

To configure a fresh project on Supabase and connect it to your application, execute the following steps:

### 1. Database Setup & SQL Migration
1. Go to your [Supabase Dashboard](https://supabase.com).
2. Create a new project (e.g., `fm-roster`).
3. Click on the **SQL Editor** in the left sidebar.
4. Click **New Query** to open a fresh script editor.
5. Copy and paste the entire contents of the `/supabase/schema.sql` file.
6. Click **Run** at the bottom-right of the editor.
   - This single unified migration script sets up the tables: `workforce`, `collections`, `submissions`, and `settings`.
   - It establishes performance indexes, cascade foreign keys, and unique constraints (e.g. only one open collection cycle can exist, and only one submission per resident per collection).
   - It inserts a trigger to update modification times automatically (`updated_at` column).
   - It inserts the **August 2026 Duty Roster** (Status: Open) as the default active collection.
   - It seeds the global settings with a randomly generated 6-digit administrative code.
   - It seeds all **30 Family Medicine residents** with randomly generated, non-sequential, completely unique 6-digit resident codes.

### 2. Storage Setup for Leave Documents
1. In the Supabase Dashboard, click on the **Storage** tab in the left sidebar.
2. Click **New Bucket**.
3. Name the bucket exactly: `leave-documents`
4. Set the bucket access to **Public** so that uploaded files can be retrieved via public URLs.
5. In the **Allowed MIME Types** configuration, add/select:
   - `application/pdf` (PDF)
   - `image/jpeg` (JPEG/JPG)
   - `image/png` (PNG)
6. Set the **Max File Size** limit to `5242880` bytes (5 MB).
7. Under the bucket settings, verify that the **Row Level Security** policies allow public selection, insertion, updates, and deletion (this is handled automatically if you run the queries at the end of `/supabase/schema.sql`).

### 3. Environment Secrets (AI Studio or Local Development)
To connect your app to Supabase, provide the target credentials inside your runtime environment variables.

In **AI Studio**:
- Go to the **Settings** menu.
- Add the following variables under the secrets/environment panel:
  - `VITE_SUPABASE_URL` = (Your Supabase Project URL, e.g., `https://xxxx.supabase.co`)
  - `VITE_SUPABASE_ANON_KEY` = (Your Supabase Public Anon Key, e.g., `eyJhbGciOi...`)

For **Local Development** (Create a `.env` file in the root):
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-actual-anon-public-key
```

---

## 📦 Production Deployment

### Client Build Configuration
To compile the application client-side, the package is set up for Vite and SPA deployments:
1. Run `npm install` to resolve project packages.
2. Run `npm run build` to compile assets.
3. The static site output will be written to the `dist/` directory, ready to be hosted on Netlify, Vercel, or AWS S3.
