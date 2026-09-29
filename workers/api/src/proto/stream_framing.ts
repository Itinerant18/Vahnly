export enum FrameType {
  FRAME_TYPE_UNSPECIFIED = 0,
  FRAME_TYPE_ASSIGNMENT = 1,
  FRAME_TYPE_TELEMETRY = 2,
}

export interface AssignmentFrame {
  order_id: string;
  driver_id: string;
  city_prefix: string;
  status: string;
}

export interface TelemetryFrame {
  order_id: string;
  driver_id: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speed_kms: number;
  timestamp_utc: number;
}

export interface WebSocketBinaryEnvelopeMessage {
  type: FrameType;
  assignment?: AssignmentFrame;
  telemetry?: TelemetryFrame;
}

class ProtoWriter {
  private chunks: Uint8Array[] = [];
  private totalLength = 0;
  private encoder = new TextEncoder();

  writeVarint(value: number): void {
    let v = value;
    const bytes: number[] = [];
    while (v > 127) {
      bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(v & 0x7f);
    const arr = new Uint8Array(bytes);
    this.chunks.push(arr);
    this.totalLength += arr.length;
  }

  writeTag(fieldNumber: number, wireType: number): void {
    this.writeVarint(fieldNumber * 8 + wireType);
  }

  writeString(fieldNumber: number, str: string): void {
    if (!str) return;
    const strBytes = this.encoder.encode(str);
    this.writeTag(fieldNumber, 2);
    this.writeVarint(strBytes.length);
    this.chunks.push(strBytes);
    this.totalLength += strBytes.length;
  }

  writeDouble(fieldNumber: number, val: number): void {
    this.writeTag(fieldNumber, 1);
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, val, true);
    this.chunks.push(buf);
    this.totalLength += 8;
  }

  writeBytes(fieldNumber: number, bytes: Uint8Array): void {
    this.writeTag(fieldNumber, 2);
    this.writeVarint(bytes.length);
    this.chunks.push(bytes);
    this.totalLength += bytes.length;
  }

  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

class ProtoReader {
  private offset = 0;
  private decoder = new TextDecoder();

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  readTag(): { fieldNumber: number; wireType: number } {
    const key = this.readVarint();
    return {
      fieldNumber: Math.floor(key / 8),
      wireType: key % 8,
    };
  }

  readVarint(): number {
    let result = 0;
    let multiplier = 1;
    for (let i = 0; i < 10; i++) {
      if (this.offset >= this.bytes.length) {
        throw new Error('protobuf_varint_truncated');
      }
      const byte = this.bytes[this.offset++];
      result += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return result;
      multiplier *= 128;
    }
    throw new Error('protobuf_varint_overflow');
  }

  readString(): string {
    const length = this.readVarint();
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error('protobuf_string_truncated');
    const value = this.decoder.decode(this.bytes.subarray(this.offset, end));
    this.offset = end;
    return value;
  }

  readBytes(): Uint8Array {
    const length = this.readVarint();
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error('protobuf_bytes_truncated');
    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  readDouble(): number {
    if (this.offset + 8 > this.bytes.length) throw new Error('protobuf_double_truncated');
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8);
    const value = view.getFloat64(0, true);
    this.offset += 8;
    return value;
  }

  skip(wireType: number): void {
    if (wireType === 0) {
      this.readVarint();
      return;
    }
    if (wireType === 1) {
      this.offset += 8;
      return;
    }
    if (wireType === 2) {
      const length = this.readVarint();
      this.offset += length;
      return;
    }
    if (wireType === 5) {
      this.offset += 4;
      return;
    }
    throw new Error(`protobuf_unsupported_wire_type_${wireType}`);
  }
}

export function encodeAssignment(frame: AssignmentFrame): Uint8Array {
  const writer = new ProtoWriter();
  if (frame.order_id) writer.writeString(1, frame.order_id);
  if (frame.driver_id) writer.writeString(2, frame.driver_id);
  if (frame.city_prefix) writer.writeString(3, frame.city_prefix);
  if (frame.status) writer.writeString(4, frame.status);
  return writer.toUint8Array();
}

export function decodeAssignment(bytes: Uint8Array): AssignmentFrame {
  const reader = new ProtoReader(bytes);
  const frame: AssignmentFrame = {
    order_id: '',
    driver_id: '',
    city_prefix: '',
    status: '',
  };
  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (wireType === 2) {
      if (fieldNumber === 1) frame.order_id = reader.readString();
      else if (fieldNumber === 2) frame.driver_id = reader.readString();
      else if (fieldNumber === 3) frame.city_prefix = reader.readString();
      else if (fieldNumber === 4) frame.status = reader.readString();
      else reader.skip(wireType);
    } else {
      reader.skip(wireType);
    }
  }
  return frame;
}

export function encodeTelemetry(frame: TelemetryFrame): Uint8Array {
  const writer = new ProtoWriter();
  if (frame.order_id) writer.writeString(1, frame.order_id);
  if (frame.driver_id) writer.writeString(2, frame.driver_id);
  if (frame.latitude !== 0) writer.writeDouble(3, frame.latitude);
  if (frame.longitude !== 0) writer.writeDouble(4, frame.longitude);
  if (frame.bearing !== 0) writer.writeDouble(5, frame.bearing);
  if (frame.speed_kms !== 0) writer.writeDouble(6, frame.speed_kms);
  if (frame.timestamp_utc !== 0) {
    writer.writeTag(7, 0);
    writer.writeVarint(frame.timestamp_utc);
  }
  return writer.toUint8Array();
}

export function decodeTelemetry(bytes: Uint8Array): TelemetryFrame {
  const reader = new ProtoReader(bytes);
  const frame: TelemetryFrame = {
    order_id: '',
    driver_id: '',
    latitude: 0,
    longitude: 0,
    bearing: 0,
    speed_kms: 0,
    timestamp_utc: 0,
  };
  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1 && wireType === 2) frame.order_id = reader.readString();
    else if (fieldNumber === 2 && wireType === 2) frame.driver_id = reader.readString();
    else if (fieldNumber === 3 && wireType === 1) frame.latitude = reader.readDouble();
    else if (fieldNumber === 4 && wireType === 1) frame.longitude = reader.readDouble();
    else if (fieldNumber === 5 && wireType === 1) frame.bearing = reader.readDouble();
    else if (fieldNumber === 6 && wireType === 1) frame.speed_kms = reader.readDouble();
    else if (fieldNumber === 7 && wireType === 0) frame.timestamp_utc = reader.readVarint();
    else reader.skip(wireType);
  }
  return frame;
}

export const WebSocketBinaryEnvelope = {
  encode(envelope: WebSocketBinaryEnvelopeMessage): Uint8Array {
    const writer = new ProtoWriter();
    if (envelope.type !== FrameType.FRAME_TYPE_UNSPECIFIED) {
      writer.writeTag(1, 0);
      writer.writeVarint(envelope.type);
    }
    if (envelope.assignment) {
      writer.writeBytes(2, encodeAssignment(envelope.assignment));
    }
    if (envelope.telemetry) {
      writer.writeBytes(3, encodeTelemetry(envelope.telemetry));
    }
    return writer.toUint8Array();
  },

  decode(input: Uint8Array): WebSocketBinaryEnvelopeMessage {
    const reader = new ProtoReader(input);
    const envelope: WebSocketBinaryEnvelopeMessage = {
      type: FrameType.FRAME_TYPE_UNSPECIFIED,
    };
    while (!reader.done) {
      const { fieldNumber, wireType } = reader.readTag();
      if (fieldNumber === 1 && wireType === 0) {
        envelope.type = reader.readVarint() as FrameType;
      } else if (fieldNumber === 2 && wireType === 2) {
        envelope.assignment = decodeAssignment(reader.readBytes());
      } else if (fieldNumber === 3 && wireType === 2) {
        envelope.telemetry = decodeTelemetry(reader.readBytes());
      } else {
        reader.skip(wireType);
      }
    }
    return envelope;
  },
};
