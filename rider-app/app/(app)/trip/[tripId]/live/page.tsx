// Legacy dynamic route — the app now uses /trip/live (flat static route).
// A dummy placeholder path is required by Next.js 16 Turbopack output:export.
export function generateStaticParams(): { tripId: string }[] {
  return [{ tripId: "__init__" }];
}

export default function LegacyLivePage() {
  return null;
}
