CONFIG FIX — .env.example files have wrong port (8080) but gateway runs on 8085. Also fix missing env vars across all 3 apps.

## Problems found (from audit)

1. `client-app/.env.example` uses port 8080 but actual gateway runs on 8085
2. `NEXT_PUBLIC_WS_URL` is missing from `rider-app/.env.example`
3. `NEXT_PUBLIC_FIREBASE_*` is missing from `rider-app/.env.example`
4. `VITE_GATEWAY_BASE_URL` is missing from `frontend/.env.example` (uses wrong key name)
5. `ALLOWED_ORIGINS` is missing from root `.env` (breaks CORS in production)

## Fix — update these exact files

### `client-app/.env.example`

Change every occurrence of port `8080` to `8085`:

- `NEXT_PUBLIC_API_GATEWAY=http://localhost:8085`
- `NEXT_PUBLIC_WS_GATEWAY=ws://localhost:8085`
- `NEXT_PUBLIC_GRPC_WEB_URL=http://localhost:8085`

### `rider-app/.env.example`

Add missing entries:
NEXT_PUBLIC_WS_URL=ws://localhost:8085
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-firebase-project-id
NEXT_PUBLIC_ENV=development

text

### `frontend/.env.example`

Fix the key name mismatch and add missing entries:
VITE_GATEWAY_BASE_URL=<http://localhost:8085>
VITE_API_BASE_URL=<http://localhost:8085>
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FCM_VAPID_KEY=your-vapid-key-from-firebase-console
VITE_ENV=development

text

### Root `.env.example` (or `.env`)

Add:
ALLOWED_ORIGINS=<http://localhost:3000,http://localhost:3001,http://localhost:5173>

text

### Add a README warning

In `README.md` (or create one at repo root if missing), add a section:

```markdown
## Environment Setup
⚠️ Copy each app's `.env.example` to `.env.local` before running:
- `cp rider-app/.env.example rider-app/.env.local`
- `cp client-app/.env.example client-app/.env.local`
- `cp frontend/.env.example frontend/.env.local`
- Gateway runs on port **8085** — not 8080
- Three different Firebase projects are used (see .env.example files for which project each app uses)
```

## Rules

- Do NOT touch actual `.env` or `.env.local` files — only `.env.example` and `README.md`
- Do NOT commit real API keys — only placeholder values like `your-firebase-api-key`
- Note the leaked Google Maps API key `AIzaSyBmZK4B5kuqxrLd3ZU8p-qcH378YChR2ZE` in root `.env` — add a comment `# ROTATE THIS KEY — was committed to git` next to it but do not remove the line (so the developer knows to rotate it)
