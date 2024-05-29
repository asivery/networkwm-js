const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function readUint8(data: DataView, offset: number): [number, number]{
    const value = data.getUint8(offset);
    return [value, offset + 1];
};

export function readUint16(data: DataView, offset: number): [number, number]{
    const value = data.getUint16(offset);
    return [value, offset + 2];
};

export function readUint32(data: DataView, offset: number): [number, number]{
    const value = data.getUint32(offset);
    return [value, offset + 4];
};

export function getUint32(data: Uint8Array, offset: number = 0) {
    return (data[offset + 0] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

export function getUint16(data: Uint8Array, offset: number = 0) {
    return (data[offset + 0] << 8) | data[offset + 1];
}

export function readBytes(data: DataView, offset: number, length: number): [Uint8Array, number]{
    const value = new Uint8Array(data.buffer.slice(offset, offset + length));
    return [value, offset + length];
};

export function readString(data: DataView, offset: number, length: number): [string, number]{
    const bytes = readBytes(data, offset, length);
    return [textDecoder.decode(bytes[0]), bytes[1]];
}

export function align(offset: number, to: number): number{
    if(offset % to === 0) return offset;
    return (Math.floor(offset / to) + 1) * to;
}

export function writeUint8(value: number): Uint8Array{
    return new Uint8Array([value]);
};

export function writeUint16(value: number): Uint8Array{
    const array = new Uint8Array(2);
    array[0] = (value >> 8) & 0xff;
    array[1] = value & 0xff;
    return array;
};

export function writeUint32(value: number): Uint8Array{
    const array = new Uint8Array(4);
    array[0] = (value >> 24) & 0xff;
    array[1] = (value >> 16) & 0xff;
    array[2] = (value >> 8) & 0xff;
    array[3] = value & 0xff;
    return array;
};
