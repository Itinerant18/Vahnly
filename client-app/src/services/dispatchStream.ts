import { BASE_URL, WS_BASE_URL } from '../api/client';
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
  /** Rider->driver chat line (forwarded verbatim as JSON, not a protobuf frame). */
  onChat?: (msg: { from: string; text: string; ts: number }) => void;
  /** Rider->driver live location during first-mile (forwarded verbatim as JSON). */
  onRiderLocation?: (loc: { lat: number; lng: number }) => void;
}

// Mint a single-use WebSocket ticket. The long-lived JWT is sent in the
// Authorization header (never in a URL), and the short-lived ticket is what
// travels in the ?ticket= query — so the JWT no longer leaks into logs/history.
export async function fetchWsTicket(token: string): Promise<string> {
  const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/api/v1/ws/ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`ws_ticket_request_failed_${res.status}`);
  }
  const data = (await res.json()) as { ticket: string };
  return data.ticket;
}

function buildStreamUrl(orderId: string, ticket: string, cityPrefix: string): string {
  const query = new URLSearchParams({
    order_id: orderId,
    ticket,
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

  const connect = async () => {
    // Tickets are single-use, so fetch a fresh one for every (re)connect.
    let ticket: string;
    try {
      ticket = await fetchWsTicket(token);
    } catch {
      if (!closedByClient) {
        reconnectTimer = setTimeout(() => void connect(), 2000);
      }
      return;
    }
    if (closedByClient) {
      return;
    }

    ws = new WebSocket(buildStreamUrl(orderId, ticket, cityPrefix));
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event: MessageEvent) => {
      // Chat lines arrive as raw JSON strings ({chat_message:{from,text,ts}}); binary
      // frames are protobuf assignment/telemetry envelopes.
      if (typeof event.data === 'string') {
        try {
          const obj = JSON.parse(event.data) as {
            chat_message?: { from?: string; text?: string; ts?: number };
            rider_location?: { lat?: number; lng?: number };
          };
          if (obj?.chat_message && callbacks.onChat) {
            callbacks.onChat({
              from: String(obj.chat_message.from ?? 'DRIVER'),
              text: String(obj.chat_message.text ?? ''),
              ts: Number(obj.chat_message.ts ?? 0),
            });
          }
          if (obj?.rider_location && callbacks.onRiderLocation) {
            callbacks.onRiderLocation({
              lat: Number(obj.rider_location.lat ?? 0),
              lng: Number(obj.rider_location.lng ?? 0),
            });
          }
        } catch { /* ignore non-JSON frames */ }
        return;
      }
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
        reconnectTimer = setTimeout(() => void connect(), 2000);
        return;
      }

      callbacks.onClose();
    };
  };

  void connect();

  return () => {
    closedByClient = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    ws?.close(1000, 'Client requested clean teardown');
  };
}
