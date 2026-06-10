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

      if ((byte & 0x80) === 0) {
        return result;
      }

      multiplier *= 128;
    }

    throw new Error('protobuf_varint_overflow');
  }

  readString(): string {
    const length = this.readVarint();
    const end = this.offset + length;
    if (end > this.bytes.length) {
      throw new Error('protobuf_string_truncated');
    }

    const value = this.decoder.decode(this.bytes.subarray(this.offset, end));
    this.offset = end;
    return value;
  }

  readBytes(): Uint8Array {
    const length = this.readVarint();
    const end = this.offset + length;
    if (end > this.bytes.length) {
      throw new Error('protobuf_bytes_truncated');
    }

    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  readDouble(): number {
    if (this.offset + 8 > this.bytes.length) {
      throw new Error('protobuf_double_truncated');
    }

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
      if (this.offset + 8 > this.bytes.length) {
        throw new Error('protobuf_skip_truncated');
      }
      this.offset += 8;
      return;
    }
    if (wireType === 2) {
      const length = this.readVarint();
      if (this.offset + length > this.bytes.length) {
        throw new Error('protobuf_skip_truncated');
      }
      this.offset += length;
      return;
    }
    if (wireType === 5) {
      if (this.offset + 4 > this.bytes.length) {
        throw new Error('protobuf_skip_truncated');
      }
      this.offset += 4;
      return;
    }
    throw new Error(`protobuf_unsupported_wire_type_${wireType}`);
  }
}

function decodeAssignment(bytes: Uint8Array): AssignmentFrame {
  const reader = new ProtoReader(bytes);
  const frame: AssignmentFrame = {
    order_id: '',
    driver_id: '',
    city_prefix: '',
    status: '',
  };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (wireType !== 2) {
      reader.skip(wireType);
      continue;
    }

    if (fieldNumber === 1) frame.order_id = reader.readString();
    else if (fieldNumber === 2) frame.driver_id = reader.readString();
    else if (fieldNumber === 3) frame.city_prefix = reader.readString();
    else if (fieldNumber === 4) frame.status = reader.readString();
    else reader.skip(wireType);
  }

  return frame;
}

function decodeTelemetry(bytes: Uint8Array): TelemetryFrame {
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
