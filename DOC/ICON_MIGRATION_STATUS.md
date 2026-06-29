# Icon Migration — Status & Resume (paused at usage limit)

Paused mid-task. Working tree has **uncommitted** workflow edits (28 files). NOT committed — build
unverified. Resume from step 1 below.

## Done (foundation — already committed earlier / present)
- Packages: `@tabler/icons-react` in all 3 apps; `@lordicon/react` in rider-app + client-app.
- `Icon.tsx` (both apps, `src/components/ds/Icon.tsx`): 62 exports + `AnimatedIcon`.
- `src/assets/icons/animated/` (both apps): 15 **PLACEHOLDER** JSONs (144 bytes, empty Lottie `layers:[]`)
  + `index.ts`. → AnimatedIcon renders nothing until real Lordicon JSONs are dropped in (no crash).
- Already migrated (committed/edited): Toaster (both), onboarding (partial).

## In progress (UNCOMMITTED — 28 files edited by the emoji→Tabler workflow)
Workflow `wf_6fd8d877-b21` (script `...workflows/scripts/emoji-to-tabler-wf_f7152a72-31f.js`, batched
waves of 5) ran but **rate-limited + session-killed twice**. ~28 of 53 files got migrated; agent judgment
looked correct (left text-emoji `🚨 DANGER`, `₹`, label strings alone per Rule 2).

## ⚠ FIRST ACTION next session: verify build (it was interrupted)
```
cd rider-app  && npx tsc --noEmit
cd client-app && npx tsc --noEmit
```
Parallel agents can mis-map an emoji or miss an import → fix any `Cannot find name 'XIcon'` /
`'@/components/ds/Icon'` errors (the export must exist in Icon.tsx; see its export list).

## Remaining files still containing emoji (re-scan — MANY are correctly text-only)
Re-run the scan, don't trust this list blindly:
```
grep -rlP "[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}]|★" rider-app/app rider-app/src client-app/app client-app/src | grep -v node_modules | grep -v assets/icons/animated
```
~41 files still match, but the agents intentionally LEFT residual **text** emoji (places labels `🏠 Home`,
settings `🚨 DANGER` in confirm(), `₹` currency, support hotline heading). Those are TEXT — leave them.
The genuinely-unmigrated **icon** files are the ~25 the workflow never reached (driver-account/*, rider/*,
dispatch, trip/*, components/DriverTripManager, OfferPopup, share, login, etc.).

## Resume options
1. **Direct (recommended now — workflow is flaky):** migrate the remaining icon files by hand using the
   `Icon.tsx` exports + the mapping in the workflow script. Skip text-emoji.
2. **Resume the workflow:** `Workflow({scriptPath: ".../emoji-to-tabler-wf_f7152a72-31f.js",
   resumeFromRunId: "wf_6fd8d877-b21", args: [<the 53-file JSON array>]})` — done agents cache-hit. But it
   rate-limited at 5/wave; drop batch to 3 if it throttles again.

## Then (to ship)
1. tsc + `npm run build` both apps green.
2. Commit + push (`feat: icon system — emoji→Tabler/Lordicon`).
3. Deploy web: `firebase deploy --only hosting --project vahnly-platform` in rider-app AND client-app
   (NOTE: `client-app npm run build` previously failed on a gutted handler — already fixed, but re-verify).
4. Rebuild both APKs (`npm run build && npx cap sync android && gradlew assembleDebug`).

## Mapping + rules
In the workflow script (`emoji-to-tabler-wf_f7152a72-31f.js`): full emoji→export map + the 6 rules
(replace icons only, never text-emoji, don't change layout/className, AnimatedIcon only for
empty-state/feature/onboarding illustrations, brand colors).
