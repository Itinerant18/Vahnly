import type { Env } from '../types';

export interface FareBreakdown {
  base_fare_paise: number;
  distance_fare_paise: number;
  time_fare_paise: number;
  surge_multiplier: number;
  surge_paise: number;
  platform_fee_paise: number;
  gst_paise: number;
  total_fare_paise: number;
}

export async function calculateFare(
  env: Env,
  cityPrefix: string,
  h3Cell: string,
  distanceKm: number,
  durationMinutes: number,
  vehicleTier = 'SEDAN'
): Promise<FareBreakdown> {
  // Base rates per tier
  let basePaise = 5000; // 50 INR
  let perKmPaise = 1500; // 15 INR / km
  let perMinPaise = 200; // 2 INR / min

  if (vehicleTier === 'HATCHBACK') {
    basePaise = 4000;
    perKmPaise = 1200;
  } else if (vehicleTier === 'SUV') {
    basePaise = 8000;
    perKmPaise = 2200;
  } else if (vehicleTier === 'PREMIUM') {
    basePaise = 10000;
    perKmPaise = 2800;
  }

  const distanceFarePaise = Math.round(distanceKm * perKmPaise);
  const timeFarePaise = Math.round(durationMinutes * perMinPaise);
  const subtotalPaise = basePaise + distanceFarePaise + timeFarePaise;

  // Read surge from KV
  let surgeMultiplier = 1.0;
  if (env.CONFIG) {
    try {
      const surgeRaw = await env.CONFIG.get(`surge:${cityPrefix}`);
      if (surgeRaw) {
        const surgeMap = JSON.parse(surgeRaw) as Record<string, number>;
        if (surgeMap[h3Cell]) {
          surgeMultiplier = surgeMap[h3Cell];
        }
      }
    } catch {}
  }

  const surgePaise = Math.round(subtotalPaise * (surgeMultiplier - 1.0));
  const platformFeePaise = 1500; // 15 INR platform fee
  const taxableAmount = subtotalPaise + surgePaise + platformFeePaise;
  const gstPaise = Math.round(taxableAmount * 0.05); // 5% GST
  const totalFarePaise = taxableAmount + gstPaise;

  return {
    base_fare_paise: basePaise,
    distance_fare_paise: distanceFarePaise,
    time_fare_paise: timeFarePaise,
    surge_multiplier: surgeMultiplier,
    surge_paise: surgePaise,
    platform_fee_paise: platformFeePaise,
    gst_paise: gstPaise,
    total_fare_paise: totalFarePaise,
  };
}
