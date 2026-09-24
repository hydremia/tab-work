# Deploying the TAB app

The app is a **static PWA**: `npm run build` produces `app/dist/` (HTML, JavaScript, CSS, icons, the service worker
and the bundled workbook template), and any static host can serve it. There is no server code. This guide covers
**Vercel** (recommended), with **Netlify** and **Cloudflare Pages** as alternatives. Nothing here is set up yet: the
steps are for whoever creates the hosting account ([SETUP_ACCOUNTS.md §3](./SETUP_ACCOUNTS.md#3-web-hosting-vercel-netlify-or-cloudflare-pages)).

**Time needed:** about 20 minutes for the first deploy, plus 5 minutes of DNS for a custom address.

## What's already in the repository

| File | What it does |
|---|---|
| [`vercel.json`](../vercel.json) | Vercel: install / build commands, output folder, SPA fallback, security and caching headers |
| [`netlify.toml`](../netlify.toml) | Netlify: build settings (headers and fallback come from the two files below) |
| [`app/public/_headers`](../app/public/_headers) | Netlify and Cloudflare Pages: security and caching headers (copied into `app/dist`) |
| [`app/public/_redirects`](../app/public/_redirects) | Netlify and Cloudflare Pages: SPA fallback (`/* /index.html 200`) |
| [`.nvmrc`](../.nvmrc) | Node 22 for the build (Netlify and Cloudflare read it) |
| [`app/deploy/hosting.ts`](../app/deploy/hosting.ts) | The one definition all of the above are generated from |

The four config files are **generated**: change `app/deploy/hosting.ts`, then run `npm run hosting-config -w app` and
commit. A unit test fails when they are out of date.

### Headers (all hosts)

- **Content-Security-Policy**: scripts, styles, fonts, workers and the manifest only from the app's own origin (no
  inline script, no `eval`), images also from `blob:` / `data:` (photos), network requests to the app itself and to
  Supabase (`https://*.supabase.co`, `wss://*.supabase.co`), no plugins, no framing (`frame-ancestors 'none'`).
  The whole e2e run (camera input, photo processing, PDF reports, workbook export and import, service worker,
  IndexedDB) runs under this policy with zero violations.
- **Permissions-Policy**: camera allowed for the app, microphone / geolocation / payment / USB off.
- **Referrer-Policy** `strict-origin-when-cross-origin`, **X-Content-Type-Options** `nosniff`, **X-Frame-Options**
  `DENY`, **Cross-Origin-Opener-Policy** `same-origin`, **Strict-Transport-Security** (2 years).
- **Caching**: `index.html`, `sw.js`, the workbox runtime, the manifest and the template are revalidated on every
  request (`max-age=0, must-revalidate`), so a new version is picked up right away; the hashed files in `/assets/`
  are cached for a year (`immutable`); icons for a day.
- **Template**: `/templates/tab-template-rev05.xlsm` is served as
  `application/vnd.ms-excel.sheet.macroEnabled.12`.

To allow only your own Supabase project instead of any `*.supabase.co`, run
`VITE_SUPABASE_URL=https://<ref>.supabase.co npm run hosting-config -w app` and commit the result (optional).

### How the workbook template gets into the build

The template lives once in git, at the repository root (`05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm`). Before every
build, `app/scripts/copy-template.mjs` copies it to `app/public/templates/tab-template-rev05.xlsm` (git-ignored), so
Vite puts it in `app/dist/templates/` and the service worker precaches it: exports work offline from the first visit.
The host therefore has to build from the **repository root** (the npm workspace), not from `app/`. When the template
changes (a new revision), update the file name in `copy-template.mjs` and the app's template map; nothing changes on
the host.

## Vercel (recommended)

### 1. Create the project

1. Sign in at **vercel.com** with the company admin mailbox (create a *Hobby* account to start, *Pro* for a team).
2. **Add New… → Project → Import Git Repository**. Connect GitHub and allow the Vercel app access to
   `hydremia/tab-work` (only that repository is enough).
3. On the configure screen:
   - **Framework Preset:** *Other* (the settings come from `vercel.json`).
   - **Root Directory:** leave it at the repository root `./`. Don't pick `app`: the build needs the npm workspace
     and the template at the root.
   - **Build / Output / Install:** leave empty; `vercel.json` sets `npm run build`, `app/dist` and `npm ci`.
4. **Environment Variables** (optional today, needed for sign-in and sync later):

   | Name | Value | Environments |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` of **tab-app-prod** | Production |
   | `VITE_SUPABASE_ANON_KEY` | the *anon public* key of tab-app-prod | Production |
   | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | the **tab-app-dev** values | Preview |

   Never enter the `service_role` key. Without these variables the app runs in **Local mode** (everything on the
   device, the banner says so), which is how it works today. They are read **at build time**: after changing them,
   redeploy (Deployments → ⋯ → Redeploy).
5. **Deploy.** The first build takes about 2 minutes. You get `https://tab-work-<something>.vercel.app`.
6. **Settings → General → Node.js Version:** 22.x.

### 2. Preview deploys per pull request

Nothing to set up: with the GitHub connection every push to a pull request gets its own preview URL, posted as a
comment and a check on the PR, and `main` deploys to production.

- Previews are protected by *Vercel Authentication* by default (only members of the Vercel team can open them).
  Keep that on, or share a preview with a tester through **Share** on the deployment.
- Each preview is a separate web address, so it has **its own storage**: projects created on a preview are not on
  production (and vice versa). Test with throw-away projects, or export / import a workbook between them.

### 3. Custom address (tab.yourcompany.com)

1. **Settings → Domains → Add** `tab.<yourdomain>.com` (Production).
2. Whoever manages the company DNS adds the record Vercel shows, normally
   `CNAME  tab  →  cname.vercel-dns.com`. HTTPS is issued automatically within minutes.
3. **Pick the final address before techs install the app.** An installed app and its data belong to the web
   address: after a change of address everyone re-installs and brings projects over by exporting and importing
   the workbook.

When sign-in is switched on, add the production address (and `https://*-<team>.vercel.app/**` for previews) under
Supabase → Authentication → URL Configuration → Redirect URLs.

### Rollback

**Deployments → the previous good deployment → ⋯ → Instant Rollback.** Open apps pick it up like any update (below).

## Netlify (alternative)

1. **app.netlify.com → Add new site → Import an existing project → GitHub →** `hydremia/tab-work`.
2. Build settings come from `netlify.toml` (base: repository root, command `npm run build`, publish `app/dist`,
   Node 22). Headers and the SPA fallback come from `_headers` / `_redirects` in the published folder.
3. **Site configuration → Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (optional, as
   above; use *Deploy contexts* to give previews the dev project).
4. Deploy previews for pull requests are on by default (**Site configuration → Build & deploy → Deploy Previews**).
5. **Domain management → Add a domain:** `tab.<yourdomain>.com`, DNS `CNAME tab → <site>.netlify.app`.

## Cloudflare Pages (alternative)

1. **dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git →** `hydremia/tab-work`.
2. **Framework preset:** None. **Build command:** `npm run build`. **Build output directory:** `app/dist`.
   **Root directory:** empty (repository root).
3. **Environment variables:** `NODE_VERSION = 22` (also in `.nvmrc`), plus the two `VITE_SUPABASE_*` values if used
   (Production and Preview can differ).
4. `_headers` and `_redirects` in `app/dist` apply automatically. Every pull request gets a preview URL.
5. **Custom domains → Set up a custom domain:** `tab.<yourdomain>.com` (a CNAME to `<project>.pages.dev`; automatic
   if the domain's DNS is on Cloudflare).

## Verify a deploy

Do this after the first deploy and after changing hosting settings. Replace the address with yours.

1. **Headers:**

   ```
   curl -sI https://tab.example.com/ | grep -iE "content-security|permissions|x-content|referrer|cache-control"
   curl -sI https://tab.example.com/templates/tab-template-rev05.xlsm | grep -iE "content-type|cache-control"
   curl -sI https://tab.example.com/p/any/route | head -1        # 200: the SPA fallback works
   ```

   Expect the CSP starting `default-src 'self'`, `camera=(self)`, `nosniff`, `max-age=0, must-revalidate` on `/`,
   and `application/vnd.ms-excel.sheet.macroEnabled.12` for the template. (Or paste the address into
   securityheaders.com.)
2. **In Chrome on a laptop:** open the address, press F12 → **Console**: no red "Refused to …" (CSP) messages.
   **Application → Manifest**: name *a2b TAB*, icons shown, no installability errors. **Application → Service
   workers**: *activated and running*.
3. **Install and offline, on a phone:** open the address. Android / Chrome shows **Install app** on the Projects
   screen (iPhone: the *Share → Add to Home Screen* hint). Install, open from the home screen, create a test project,
   turn on **airplane mode**, add a unit, take a photo, **Export** the workbook and a PDF report. Everything must
   work offline. Then delete the test project.
4. **Updates:** after the next deploy, an open app shows **"Update available — Reload"** within the hour (or the next
   time it's opened). Tap **Reload**.

## Without a hosting account

Every CI run (pull request or push) uploads the built app as an artifact: **GitHub → Actions → the run → Artifacts →
`app-dist-<commit>`**. Download and unzip it, then from a checkout of the repository:

```
npm ci
rm -rf app/dist && mkdir -p app/dist && unzip app-dist-<commit>.zip -d app/dist
npm run serve-dist -w app            # http://localhost:4173 with the production headers
```

`npm run serve-dist -w app` serves any local `npm run build` the same way; the e2e run uses it too.
`npm run pwa-check -w app` checks a build (manifest, icons, service worker precache, headers files) without a
browser; CI runs it after every build.

## How updates reach the phones

The service worker keeps the whole app on the device. When a new version is deployed, an open app finds it (on
start-up and every hour) and downloads it in the background, then shows **"Update available — Reload"**. Nothing
reloads by itself, so a half-typed reading is never lost; **Later** hides the message until the app is next opened.
If nobody taps Reload, the new version starts the next time the app is opened after all its windows were closed.
Data in IndexedDB is not touched by updates.
