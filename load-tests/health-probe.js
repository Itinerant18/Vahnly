// Smoke / reachability probe. Run this FIRST to confirm the gateway is up and the suite
// can reach it before launching a real load scenario.
//   k6 run -e BASE_URL=http://localhost:8085 load-tests/health-probe.js
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from './config.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const res = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  check(res, {
    'gateway reachable': (r) => r.status !== 0,
    'health 200/503': (r) => r.status === 200 || r.status === 503,
  });
  console.log(`GET ${BASE_URL}/health -> ${res.status} (${res.timings.duration.toFixed(0)}ms)`);
}
