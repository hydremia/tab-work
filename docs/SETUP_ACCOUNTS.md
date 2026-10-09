# Accounts & Admin Setup Checklist

Everything the company needs to set up or approve. Needed before more than one person works a project (the
multi-user pilot); the order to do it in, and adding a technician: **[ADMIN_PILOT_SETUP.md](./ADMIN_PILOT_SETUP.md)**. Total recurring cost
is roughly **$25–45/month** (less if you already have Supabase Pro); confirm current prices at signup.

Tip: create the accounts with a **shared company admin mailbox** (e.g. `admin@…`), not a personal email, so
ownership doesn't leave with an employee.

## 1. Microsoft 365: "Sign in with Microsoft" (needs your M365 admin, about 15 minutes)

This lets techs and PMs log in with the work accounts they already use. When someone leaves the company and
their M365 account is disabled, they automatically lose access to the app.

**Who:** someone with the *Global Administrator* or *Application Administrator* role in Microsoft 365.

**Steps.** Exact values and the Supabase side: **[SYNC_SETUP.md](./SYNC_SETUP.md)** (steps 4–5).
1. Go to **entra.microsoft.com → App registrations → New registration**.
   - Name: `TAB App`
   - Supported account types: **"Accounts in this organizational directory only"** (single tenant, company
     accounts only)
   - Redirect URI (Web): `https://<project-ref>.supabase.co/auth/v1/callback` (the Supabase project's address)
2. Under **Certificates & secrets**, create a client secret and copy its value.
3. Under **API permissions**, keep the default `User.Read` (plus `openid`, `email`, `profile`), then click
   **Grant admin consent**.
4. *(Optional)* Under **Enterprise applications → TAB App → Properties**, require assignment and assign a group
   such as "TAB App Users" so only that group can sign in.
5. Send me the **Application (client) ID** and **Directory (tenant) ID**. These are not secrets. **Do not send the
   client secret.** Paste it yourself into Supabase → Authentication → Providers → Azure. It never goes in chat,
   the repo or the app.

**Cost:** free, included with M365.

*Fallback if an admin isn't available right away:* sign-in by email code, limited to your company's email
domain. No admin is needed, and we can switch to Microsoft sign-in later.

## 2. Supabase (database, photo storage, live sync)

- An existing **Pro** organization works; you don't need a new org or account. Add a project `tab-app-dev` to it,
  and later `tab-app-prod`. Each extra project adds about $10/mo of compute. Pro includes daily backups and 100 GB of
  storage, so photos are effectively free at our volume.
- Send the **project URL** and the **anon (public) key**. Row-level security protects the data, so these two are safe
  to put in the app. **Never send or use the `service_role` key**, which stays in the Supabase dashboard.
- **Photos are stored here**, in cloud storage managed by Supabase. Nothing is self-hosted and nothing goes in Dropbox.
- Once the projects exist, **[SYNC_SETUP.md](./SYNC_SETUP.md)** walks through the rest: applying the database
  migrations, the photo bucket, Microsoft sign-in, the two Vercel settings, the first sign-in, a two-device check and
  the rollback plan.

## 3. Web hosting (Vercel, Netlify or Cloudflare Pages)

- Free tier to start (about $20/mo if we need team features). Connect it to the GitHub repo `hydremia/tab-work`.
- The repository is ready for all three (config files, security headers, caching). Step-by-step setup, environment
  variables, preview deploys per pull request, the custom address and how to check a deploy:
  **[DEPLOY.md](./DEPLOY.md)**.

## 4. App address (optional but recommended)

- Whoever manages your company domain's DNS adds one record, e.g. `tab.<yourdomain>.com` → the hosting
  provider. This takes about 5 minutes. Details per host: [DEPLOY.md](./DEPLOY.md#3-custom-address-tabyourcompanycom).
- Decide the address **before** techs install the app: an installed app and its data belong to that address.

## 5. Error monitoring (Sentry, free tier)

- Optional. Lets us see crashes from phones in the field without asking techs for screenshots.

## Not needed

- **Dropbox integration:** none. Exports download to the device, and users save them into the project's Dropbox
  folder as they do today. On a laptop that's the Dropbox folder; on a phone it's the share sheet → Dropbox. To
  re-import, users pick the file from Dropbox the same way.
- **App Store or Google Play accounts:** not needed. The app installs as a home-screen shortcut.
