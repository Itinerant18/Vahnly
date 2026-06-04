import { WS_BASE_URL } from '../api/client';
import {
  AssignmentFrame,
  FrameType,
  TelemetryFrame,
  WebSocketBinaryEnvelope,
} from '../proto/stream_framing';

export interface DispatchStreamCallbacks {
  onAssignment: (frame: AssignmentFrame) => void;
  onTelemetry: (frame: TelemetryFrame) => void;
  onClose: () => void;
}

function buildStreamUrl(orderId: string, token: string, cityPrefix: string): string {
  const query = new URLSearchParams({
    order_id: orderId,
    jwt: token,
    city_prefix: cityPrefix,
  });

  return `${WS_BASE_URL.replace(/\/$/, '')}/api/v1/dispatch/stream?${query.toString()}`;
}

export function connectDispatchStream(
  orderId: string,
  token: string,
  callbacks: DispatchStreamCallbacks,
  cityPrefix = 'KOL',
): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByClient = false;

  const connect = () => {
    ws = new WebSocket(buildStreamUrl(orderId, token, cityPrefix));
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) {
        return;
      }

      const envelope = WebSocketBinaryEnvelope.decode(new Uint8Array(event.data));
      if (envelope.type === FrameType.FRAME_TYPE_ASSIGNMENT && envelope.assignment) {
        callbacks.onAssignment(envelope.assignment);
      } else if (envelope.type === FrameType.FRAME_TYPE_TELEMETRY && envelope.telemetry) {
        callbacks.onTelemetry(envelope.telemetry);
      }
    };

    ws.onclose = (event: CloseEvent) => {
      if (closedByClient) {
        callbacks.onClose();
        return;
      }

      if (event.code === 1001) {
        reconnectTimer = setTimeout(connect, 2000);
        return;
      }

      callbacks.onClose();
    };
  };

  connect();

  return () => {
    closedByClient = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    ws?.close(1000, 'Client requested clean teardown');
  };
}
