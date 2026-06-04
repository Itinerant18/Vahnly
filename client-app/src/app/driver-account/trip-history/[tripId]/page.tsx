import { TRIP_HISTORY } from '../tripData';
import TripDetailClient from './TripDetailClient';

// Static export needs the set of trip ids known at build time.
export function generateStaticParams() {
  return TRIP_HISTORY.map((t) => ({ tripId: t.id }));
}

export default async function TripDetailPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <TripDetailClient tripId={tripId} />;
}
