import type { MessageBatch } from '@cloudflare/workers-types';
import type { Env, DomainEvent } from './types';
import { getDb } from './services/db';

export async function handleQueueBatch(
  batch: MessageBatch<DomainEvent>,
  env: Env
): Promise<void> {
  const sql = getDb(env, { write: true });

  for (const message of batch.messages) {
    try {
      const event = message.body;
      const topic = event.topic;
      const payload = event.payload;

      switch (topic) {
        case 'order.created': {
          const orderId = payload.order_id as string;
          const cityPrefix = (payload.city_prefix as string) || env.CITY_PREFIX || 'KOL';
          const pickupLat = payload.pickup_lat as number;
          const pickupLng = payload.pickup_lng as number;
          const pickupH3 = payload.pickup_h3 as string;

          const dispatchStub = env.CITY_DISPATCH_DO.getByName(cityPrefix);
          const matchResult = await dispatchStub.matchOrder({
            id: orderId,
            pickup_lat: pickupLat,
            pickup_lng: pickupLng,
            pickup_h3: pickupH3,
          });

          if (matchResult.matched && matchResult.driverId) {
            // Assign order in DB
            await sql`
              UPDATE orders
              SET status = 'ASSIGNED',
                  driver_id = ${matchResult.driverId}::uuid,
                  assigned_at = now()
              WHERE id = ${orderId}::uuid
            `;

            // Fan out via OrderStreamDO
            const orderStreamStub = env.ORDER_STREAM_DO.getByName(orderId);
            await orderStreamStub.broadcastAssignment({
              order_id: orderId,
              driver_id: matchResult.driverId,
              city_prefix: cityPrefix,
              status: 'ASSIGNED',
            });

            // ALSO fan out to global-driver stream so the idle driver app receives the assignment!
            try {
              const globalDriverStream = env.ORDER_STREAM_DO.getByName('global-driver');
              await globalDriverStream.broadcastJSON({
                type: 'order.assigned',
                order_id: orderId,
                driver_id: matchResult.driverId,
                city_prefix: cityPrefix,
                status: 'ASSIGNED',
              });
            } catch (streamErr) {
              console.error('[queue] Failed to broadcast to global-driver stream:', streamErr);
            }

            // Fan out via RiderStreamDO
            const riderId = payload.customer_id as string;
            if (riderId) {
              const riderStreamStub = env.RIDER_STREAM_DO.getByName(riderId);
              await riderStreamStub.pushTripEvent({
                type: 'rider.order.assigned',
                data: {
                  order_id: orderId,
                  driver_id: matchResult.driverId,
                  driver_name: 'Assigned Driver',
                  driver_photo: '',
                  driver_rating: 4.85,
                  driver_trips_count: 120,
                  transmission_expertise: 'MANUAL',
                  eta_minutes: 5,
                  eta_km: matchResult.distanceKm || 1.5,
                  vehicle_context: 'SEDAN',
                  status: 'ASSIGNED',
                },
              });
            }
          }
          break;
        }

        case 'order.assigned': {
          const orderId = payload.order_id as string;
          const orderStream = env.ORDER_STREAM_DO.getByName(orderId);
          await orderStream.broadcastJSON({
            type: 'order.assigned',
            data: payload,
          });
          break;
        }

        case 'order.cancelled': {
          const orderId = payload.order_id as string;
          const driverId = payload.driver_id as string;
          const cityPrefix = (payload.city_prefix as string) || env.CITY_PREFIX || 'KOL';

          if (driverId) {
            const dispatchStub = env.CITY_DISPATCH_DO.getByName(cityPrefix);
            await dispatchStub.setDriverStatus(driverId, 'ONLINE_AVAILABLE');
          }

          const orderStream = env.ORDER_STREAM_DO.getByName(orderId);
          await orderStream.broadcastJSON({
            type: 'order.cancelled',
            data: payload,
          });

          const riderId = payload.rider_id as string;
          if (riderId) {
            const riderStream = env.RIDER_STREAM_DO.getByName(riderId);
            await riderStream.pushTripEvent({
              type: 'rider.trip.cancelled',
              data: {
                order_id: orderId,
                cancelled_by: (payload.cancelled_by as 'RIDER' | 'DRIVER' | 'ADMIN' | 'SYSTEM') || 'SYSTEM',
                reason: (payload.reason as string) || 'Cancelled',
                cancellation_fee_paise: (payload.cancellation_fee_paise as number) || 0,
              },
            });
          }
          break;
        }

        case 'driver.rated': {
          const driverId = payload.driver_id as string;
          const rating = payload.rating as number;
          if (driverId && rating) {
            await sql`
              UPDATE drivers
              SET rating = (rating * rating_count + ${rating}) / (rating_count + 1),
                  rating_count = rating_count + 1
              WHERE id = ${driverId}::uuid
            `.catch(() => {});
          }
          break;
        }

        default: {
          // Log other domain events
          console.log(`[Queue] Handled domain event topic: ${topic}`);
          break;
        }
      }

      message.ack();
    } catch (err) {
      console.error('[Queue] Error processing message:', err);
      message.retry();
    }
  }
}
