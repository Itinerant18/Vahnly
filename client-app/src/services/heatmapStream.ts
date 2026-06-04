import { SSE_URL } from '@/api/client';

export interface HeatmapData {
  region: string;
  timestamp: number;
  cell_data: Record<string, number>;
}

export function connectHeatmapStream(onUpdate: (data: HeatmapData) => void): () => void {
  const es = new EventSource(`${SSE_URL.replace(/\/$/, '')}/api/v1/analytics/heatmap`);

  es.onmessage = (event) => {
    const parsed = JSON.parse(event.data) as HeatmapData;
    onUpdate(parsed);
  };

  es.onerror = (event) => {
    console.error('[HEATMAP_STREAM] SSE connection error:', event);
  };

  return () => es.close();
}
