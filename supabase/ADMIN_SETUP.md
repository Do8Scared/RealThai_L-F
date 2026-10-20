# Admin Portal Setup

The user portal remains `index.html`. The administrator portal is separate at `admin.html` and requires a verified PUP email plus an administrator role in Supabase.

## Apply migrations

Run the SQL files in `supabase/migrations` in filename order using the Supabase SQL editor. The `20260927000000_create_items_table.sql` baseline must run first; it creates the item table and its PUP-scoped RLS policies before the post-number and campus migrations alter it. Later migrations add admin workflows, private evidence storage, feedback reports, account metrics, and hierarchical admin roles. If the paid announcement migration was already applied, also run `20261020000200_user_selected_announcement_duration.sql` to let users choose 1–5 hours at PHP 10 per hour and `20261020000300_prevent_duplicate_announcement_requests.sql` to block duplicate in-progress requests.

Configure the Supabase URL and public anon key in `js/supabase-config.js`. Add the local and production `admin.html` URLs to Supabase Auth's allowed redirect URLs so email links return to the administrator portal.

## Bootstrap the first administrator

1. Open `admin.html`, request admin access with the first administrator's PUP email, and verify the email link.
2. In the Supabase SQL editor, grant that verified account the initial Super Admin role. Apply the role-hierarchy migration first so the `role` column exists:

```sql
INSERT INTO public.admin_users (user_id, email, role)
SELECT id, email
FROM auth.users
WHERE lower(email) = lower('REPLACE_WITH_FIRST_ADMIN@iskolarngbayan.pup.edu.ph')
ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin';
```

3. Reload `admin.html` and sign in. The first Super Admin can approve Common Admin access requests and manage existing admin roles.

Admin privileges are never granted by browser-side signup. Requests remain pending until a Super Admin approves them; approval grants the Common Admin role. Common Admins can view the admin access queue read-only, but cannot approve or reject requests, change roles, or revoke admin access.

Keep at least two trusted Super Admins for recovery. The database blocks self-demotion and removal or demotion of the last Super Admin. Revoking a row in `admin_users` removes administrator access only; it does not delete the person's Supabase account or their reports.