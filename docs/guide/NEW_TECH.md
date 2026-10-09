# New technician: getting started with the a2b TAB app

Welcome. This is your first-week guide: how to set up your device, and how to work a job **alongside another tech
on the same project**. For the day-to-day screens, see the short [Quick start](./QUICK_START.md). The full
[User guide](./USER_GUIDE.md) covers every unit type and has the troubleshooting FAQ.

**What the app does:** you enter TAB readings on your phone, tablet or laptop, and the app fills in the a2b TAB
workbook (`.xlsm`, template revision 08) for you. It works with no signal. When you're signed in, everything
you enter syncs to the team: your lead sees your readings, photos and issues within a minute, and you see theirs.

---

## Before the job (at home or the office, on Wi-Fi, about 15 minutes)

Your admin will send you the app link and confirm your Microsoft account is set up.

1. **Use the right browser.** iPhone / iPad: **Safari**. Android: **Chrome**. Laptop: **Chrome** or **Edge**.
2. **Open the link and install the app.** On the **Projects** screen, tap **Install app** on the *Install a2b TAB
   on this device* card. On iPhone / iPad: **Share** (square with an arrow) → **Add to Home Screen** → **Add**.
   From now on, **always open it from the home-screen icon.** On iPhone, the icon and Safari keep separate
   data.
3. **Sign in.** Tap the pill at the top right (*Not signed in*) → **Sign in with Microsoft** → your work account
   (`you@…`). Accept the permissions the first time.
   - If the device had projects from before, the app asks **Move projects to the cloud**. Untick anything that
     was only practice, then tap **Upload**, or **Continue without uploading**.
4. **Name this device.** A yellow banner asks for a name: tap **Phone**, **Tablet** or **Laptop**, or type one
   (e.g. *Sam's iPhone*) → **Save**. Your teammates then see *Sam Lee · Phone* next to your changes.
5. **Wait for "Synced".** The company's projects download to your device. Open the pilot project once and tap
   through its units, so everything is on the device before you lose signal on site.
6. **Check your instruments.** Open the project → **Info** → instruments. Your meters need to be there with
   current calibration dates. If one is missing, tell your lead; it's added once in the **Library**.

**Check you're ready:** the pill says **Synced**, the round button next to it shows your initials, and the
project is on your Projects screen.

---

## The status pill (top right)

| It says | Meaning | What to do |
|---|---|---|
| **Synced** (cloud with a tick) | Everything you did is in the cloud. | Nothing. |
| **Syncing…** / **3 unsynced** | Changes are on their way (they go about 2 seconds after you type). | Nothing. |
| **Offline · 5 unsynced** | No signal. Your edits are saved on the device and waiting. | Keep working. They send when the signal is back. |
| **Paused · N not sent** | You paused sync (Sync & account → Pause sync). | **Resume sync** when you can. |
| **Not signed in** | You're signed out; nothing syncs. | Tap it → **Sign in with Microsoft**. |
| **Sync error** | Something's wrong (tap the pill for the message). | Tell your lead, and keep working. Nothing is lost. |
| **Local** | Sync isn't switched on in this app. Everything stays on this device only. | Ask your admin before working a shared project. |

Tap the pill (or your initials) any time for **Sync & account**: who's signed in, **Sync now**, **Pause sync** and
**Sign out**.

---

## Working a job with another tech

You and your lead are in the **same project** at the same time. The app merges your work:

- **Stick to your units.** Agree at the start who takes which units (e.g. you: the DOAS and the exhaust fans).
  Two people can work in the same unit, but if you both type in the **same field** before either of you has
  synced, it becomes a conflict to sort out.
- **Units are usually already added** from the schedule. If you add one, check the designation (e.g. `EF-4`)
  isn't already there.
- **No signal is fine.** Keep going. Everything saves on the device as you type, and sends when you're back in
  range. Before you leave the site, step outside or onto Wi-Fi until the pill says **Synced**.
- **Photos** upload in the background. They need signal, so let them finish before you leave.
- **Conflicts** (the same field changed on two devices) show on the **Attention** tab with both values. Tap
  **Keep current** or **Use "…"**. If you're not sure which value is right, ask before you pick.
- **"Issued as … — unlock to edit"** banner: your lead issued the report, and the project is **locked** for
  everyone. Your forms are read-only. Any edit you made offline before the lock reached you is kept on your
  phone and listed on the **Attention** tab as *not synced*. It sends when the project is **unlocked**. Don't
  unlock it yourself unless your lead asks.
- **Don't delete projects.** When you're signed in, **Delete project** removes it for everyone.
- **Who changed what:** the **History** tab shows every change with the person and device.

---

## On site: each unit

The full steps are in the [Quick start](./QUICK_START.md#4-fill-a-unit). In short:

1. **Equipment** → tap the unit. Set **New / Existing**.
2. Work down the sections: identity, design data, nameplate, motor (volts and amps per leg), drive, RPM,
   **static pressure profile**, airflow.
3. **Static pressure profile** (revision 08): the components show in the unit's real airflow order, e.g. Carrier
   RTU: *Filter → Coil → (Reheat) → Fan → Heat*; Addison DOAS: *Filter → Coil → Wheel → Reheat → Fan → Heat*;
   EF: *Fan*.
   - Enter the **entering** static, then the static **leaving** each component you can reach.
   - **3-point readings** (entering, fan inlet, discharge): set **Static taps** to *3-point*. The labels then show which
     field is the **fan inlet** and which is the **discharge**.
   - **Has reheat coil?** and **Unit has filters?** hide what the unit doesn't have.
   - The diagram under the fields shows where each reading sits on the unit. Tap a tap point to jump to its field.
     If the order on the diagram doesn't match the unit in front of you, tell your lead. The order comes from
     the unit library and can be corrected there.
4. Pick your **instrument** on each airflow section.
5. **Photos:** **Unit**, **Unit label / tag**, **OA damper** (and **Motor** where asked), or mark them N/A.
6. **Show missing** at the top lists what's still blank. Fill it or mark it N/A until the card turns **green**.

**N/A, not blank.** Blank means "not done yet". If something doesn't apply, tap **N/A…** beside it and choose
**N/A** (doesn't apply), **Not Avail.** (can't read it, nameplate gone) or **Not Acc.** (can't get to it).

**Card colors:** gray = not started · amber = in progress · green = complete · red = open issue or reading out of
tolerance · blue = reviewed.

**Issues:** **Issues** tab → **Add new issue** (or **Add existing issue**) → pick the unit → describe it → add a photo. An open issue turns its
unit red until it's closed. Use **Add observation** for a note that isn't a deficiency (it never turns a unit red).

---

## End of each day

1. **Attention** tab: work through what you can, and settle any conflicts.
2. Get signal until the pill says **Synced**, with no *unsynced* count and no photos uploading.
3. Tell your lead you're synced. **They export the workbook** and save it to Dropbox. You don't need to export
   unless they ask.

---

## Don'ts

- Don't open the app in a browser tab instead of the home-screen icon (iPhone keeps them separate).
- Don't clear browser data, delete the app or reset the device while the pill shows **unsynced** changes. Those
  changes exist only on your device until they send.
- Don't **Issue report**, **Unlock** or **Delete project** unless your lead asks you to.
- On a borrowed or shared device, don't just sign out: use **Sync & account → Sign out and remove data from this
  device**.

---

## Help

- **The app looks old, or a fix isn't showing:** **Check for updates** (bottom of the Projects screen) →
  **Reload**. Your entries are kept.
- **A project is missing:** check the pill says **Synced**, then tap **Sync now**. Still missing? Ask your lead.
  It may not be in the cloud.
- **Microsoft says you're "not assigned" (AADSTS50105):** your admin needs to add you to the app's user group.
- **Anything else:** the FAQ in the [User guide](./USER_GUIDE.md#12-troubleshooting-and-faq), then your lead.
