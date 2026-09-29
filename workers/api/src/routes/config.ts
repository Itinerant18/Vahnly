import { Hono } from 'hono';
import type { Env } from '../types';

const config = new Hono<{ Bindings: Env }>();

const DEFAULT_FLAGS = {
  maintenance_mode: false,
  surge_pricing_enabled: true,
  fcm_push_enabled: true,
  phone_otp_enabled: true,
  sos_enabled: true,
  supported_regions: ['KOL', 'BLR'],
  driver_auto_assignment: true,
  min_driver_app_version: '1.0.0',
  min_rider_app_version: '1.0.0',
};

config.get('/api/v1/config/flags', async (c) => {
  if (c.env.CONFIG) {
    try {
      const raw = await c.env.CONFIG.get('flags');
      if (raw) {
        return c.json(JSON.parse(raw));
      }
      // Seed default flags if not set
      await c.env.CONFIG.put('flags', JSON.stringify(DEFAULT_FLAGS));
    } catch (err) {
      console.warn('[config] KV read failed, using defaults:', err);
    }
  }
  return c.json(DEFAULT_FLAGS);
});

config.get('/api/v1/config/app-version', (c) => {
  return c.json({
    app_version: c.env.APP_VERSION || '1.0.0',
    min_supported_version: '1.0.0',
    force_update: false,
  });
});

export default config;
