# Accounts & Admin Setup Checklist

Everything the company needs to set up or approve. None of it is needed until **Phase 1**. Total recurring cost
is roughly **$25–45/month**; confirm current prices at signup.

Tip: create the accounts with a **shared company admin mailbox** (e.g. `admin@…`), not a personal email, so
ownership doesn't leave with an employee.

## 1. Microsoft 365: "Sign in with Microsoft" (needs your M365 admin, about 15 minutes)

This lets techs and PMs log in with the work accounts they already use. When someone leaves the company and
their M365 account is disabled, they automatically lose access to the app.

**Who:** someone with the *Global Administrator* or *Application Administrator* role in Microsoft 365.

**Steps.** I'll provide exact values when we reach Phase 1.
1. Go to **entra.microsoft.com → App registrations → New registration**.
   - Name: `TAB App`
   - Supported account types: **"Accounts in this organizational directory only"** (single tenant, company
     accounts only)
   - Redirect URI (Web): the Supabase callback URL, which I'll provide
2. Under **Certificates & secrets**, create a client secret and copy its value.
3. Under **API permissions**, keep the default `User.Read` (plus `openid`, `email`, `profile`), then click
   **Grant admin consent**.
4. *(Optional)* Under **Enterprise applications → TAB App → Properties**, require assignment and assign a group
   such as "TAB App Users" so only that group can sign in.
5. Send me (privately, not in chat or the repo) the **Application (client) ID**, **Directory (tenant) ID** and
   the **client secret**. These get entered into Supabase, not the code.

**Cost:** free, included with M365.

*Fallback if an admin isn't available right away:* sign-in by email code, limited to your company's email
domain. No admin is needed, and we can switch to Microsoft sign-in later.

## 2. Supabase (database, photo storage, live sync)

- Create an account at supabase.com with the admin mailbox, then create an organization named `a2b`.
- Create two projects: `tab-app-dev` (free) and `tab-app-prod` (**Pro plan, about $25/mo**, which adds daily backups
  and about 100 GB of storage).
- Add me as a developer, or share the project URL and keys through a secure channel when we get there.
- **Photos are stored here**, in cloud storage managed by Supabase. Nothing is self-hosted and nothing goes in Dropbox.

## 3. Web hosting (Vercel, Netlify or Cloudflare Pages)

- Free tier to start (about $20/mo if we need team features). Connect it to the GitHub repo `hydremia/tab-work`.

## 4. App address (optional but recommended)

- Whoever manages your company domain's DNS adds one record, e.g. `tab.<yourdomain>.com` → the hosting
  provider. This takes about 5 minutes.

## 5. Error monitoring (Sentry, free tier)

- Optional. Lets us see crashes from phones in the field without asking techs for screenshots.

## Not needed

- **Dropbox integration:** none. Exports download to the device, and users save them into the project's Dropbox
  folder as they do today. On a laptop that's the Dropbox folder; on a phone it's the share sheet → Dropbox. To
  re-import, users pick the file from Dropbox the same way.
- **App Store or Google Play accounts:** not needed. The app installs as a home-screen shortcut.
