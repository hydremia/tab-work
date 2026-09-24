# a2b TAB app: Quick start

For techs and PMs. Two pages, phone first. The full guide is in [USER_GUIDE.md](./USER_GUIDE.md).

> **Right now the app runs in Local mode.** You'll see the banner *"Local mode — not signed in / not syncing. Saved
> on this device only."* Microsoft sign-in and cloud sync aren't live yet, so your data exists **only on the
> phone, tablet or laptop you entered it on**. **Export the workbook often.** The exported file is your backup.

## 1. Install it (once per device)

Open the app link your office sent you, then:

| Device | Steps |
|---|---|
| **iPhone / iPad** (use Safari) | Tap **Share** (square with an arrow) → **Add to Home Screen** → **Add**. |
| **Android** (use Chrome) | Tap **⋮** → **Install app** (or **Add to Home screen**) → **Install**. |
| **Laptop** (Chrome or Edge) | Click the install icon at the right end of the address bar, or **⋮ / …** → **Install a2b TAB**. |

From then on, open **a2b TAB** from the home screen or Start menu. After the first open it works with no signal.
On iPhone/iPad, always use the home-screen icon. Its data is separate from the same site opened in Safari.

## 2. Create a project

**Projects** → **+ New project** → enter the **Project name**, **Physical address** and **TAB date** → pick a
**Scope profile** (**Full TAB**, **Airflow Only** or **Custom**) → **Create project**.

Then fill in the rest on the **Info** tab: engineer, contractors, technician(s), PM, report date, narrative,
blueprints, cover photo, instruments and building pressures. The card at the top of Info lists what's still missing.

## 3. Add equipment

**Equipment** tab → **+ Add equipment** → pick the type (RTUs, MAUs, ERVs, Fans, Small fans, VAVs, Hoods,
Traverses) → check the designation (e.g. `RTU-3`) → **New** or **Existing** → **Add RTU-3** (or **Add & add
another**).

Have the mechanical schedule in Excel? Use **Import schedule** and paste the rows in. See the full guide.

## 4. Fill a unit

Tap a unit card. Work down the sections, or tap a chip in the bar at the top (**Identity**, **Design data**…) to
jump to one. Everything saves as you type. There's no Save button.

- A **\*** means the field is required for the unit to turn green.
- **Add outlet** copies the area, type, size and Ak from the row above and numbers it S-2, S-3…
- CFM, % of design, TSP/ESP, corrected FLA and BHP work themselves out as you type.
- **Show missing** at the top lists every item still blank.

**Card colors:** gray = not started · amber = in progress · green = complete · red = needs attention (an open
issue, or a reading outside ±10 %).

## 5. N/A, not blank

Blank means "not done yet". If something doesn't apply, mark it:

- **Field:** tap **N/A…** next to it → **Mark N/A**, **Mark Not Avail.** or **Mark Not Acc.**
- **Section:** **⋮** on the section → **Mark section N/A** (etc.).
- **Whole unit:** at the bottom of the unit → **Whole unit N/A**.
- **Airflow row:** **Row…** → pick the column and notation.

The app marks many things N/A for you (for example, belt data on a direct-drive fan). Those show **Auto N/A**.

## 6. Photos

On each unit's **Photos** section, tap **Take photo** (camera) or **Choose** (camera roll) for **Unit**,
**Unit label / tag** and **OA damper**. They're required unless you mark them N/A. Deficiency photos go on the issue
(**Issues** tab). The cover photo goes on **Info**.

## 7. Export the workbook

**Export** tab → check the **Revision** label (**Prelim**, **Rev 1**…) → **Export Prelim (.xlsm)**. You can export
before everything is green. The app then says the report is preliminary.

Photo and issue PDFs are further down the same tab: **Photo Report**, **Issues Report**, **Issues + Photos**,
**Photos (.zip)**.

## 8. Save it to Dropbox

The app downloads the file. It doesn't upload anywhere by itself.

- **iPhone/iPad:** in the download prompt, tap the file → **Share** → **Save to Files** → **Dropbox** → the
  project folder. (Or open **Files** → **Downloads** later.)
- **Android:** open the **Dropbox** app → **+** → **Upload files** → **Downloads** → pick the file.
- **Laptop:** move the file from **Downloads** into the project's Dropbox folder.

The copy in Dropbox is the official record of that issued report.

## Top 5 rules

1. **Install it** to the home screen, and always open it from there.
2. **Mark N/A.** Never leave a field blank on purpose.
3. **Export at the end of every site day** and save the file to Dropbox. That's your backup.
4. **Don't clear browser data or delete the app** unless you've exported first. That erases the projects on that
   device.
5. For follow-up, **re-import the issued workbook** (Export tab → **Re-import workbook**) before you export
   again, so the edits made in Excel carry forward.
