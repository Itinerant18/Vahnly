// Legacy dynamic route — the app now uses /trip/bill (flat static route).
export function generateStaticParams(): { tripId: string }[] {
  return [{ tripId: "__init__" }];
}

export default function LegacyBillPage() {
  return null;
}
