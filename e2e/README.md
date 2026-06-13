# Cross-app e2e + visual regression (Playwright)

End-to-end and visual-regression tests spanning the three frontends. All API and
realtime traffic is mocked per-spec with `page.route()` / `routeWebSocket()`, so
**no backend is required** — only the app dev servers.

## Install

```bash
cd e2e
npm install
npx playwright install chromium
```

## Run

Start the relevant dev server(s), then run the matching project:

```bash
# rider-app on :3050  (rider-auth, rider-booking, design-system)
npm --prefix ../rider-app run dev

npm test -- --project=rider
npm test -- --project=design
```

| Project | Spec | App / baseURL | Status |
|---|---|---|---|
| `rider`  | `rider-auth.spec.ts`     | rider-app `:3050` | ✅ passing (verified live) |
| `rider`  | `rider-booking.spec.ts`  | rider-app `:3050` | home-render ✅; full booking + WS = `fixme`/`skip` (see notes) |
| `design` | `design-system.spec.ts`  | rider-app `:3050` | ✅ passing (light/dark `data-theme`, mono) |
| `admin`  | `admin-kyc.spec.ts`      | frontend `:5173`  | scaffold — confirm admin routes/token/DOM |
| `visual` | `visual.spec.ts`         | all three         | needs baselines (`npm run update-snapshots`) |

`RIDER_URL`, `DRIVER_URL`, `ADMIN_URL` env vars override the default ports.
Uncomment the `webServer` block in `playwright.config.ts` to have Playwright boot
the dev servers automatically.

## Visual regression (Task 4)

Baselines live in `tests/visual.spec.ts-snapshots/`. The config fails a screen
when more than 1% of pixels differ (`maxDiffPixelRatio: 0.01`).

```bash
npm run update-snapshots   # generate/refresh baselines (first run or intended UI change)
npm test -- --project=visual
```

Driver + admin visual screens are `test.skip` until their apps + baselines are
wired in your environment.

## Notes / scaffolds to finish

- **rider-booking full flow** (`fixme`): the booking sheet is collapsed by default
  and its drag handle detaches on the expand re-render, so driving the form
  headlessly is flaky. Add a stable expand affordance (e.g. `aria-expanded` +
  `data-testid`) to enable the booking→dispatch assertion. The realtime
  driver-assigned step is `skip` pending the confirmed WS URL + envelope.
- **admin-kyc**: written against assumed admin routes/token key/DOM — confirm
  against `frontend/src/admin` before relying on it.
