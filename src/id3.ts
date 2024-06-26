import { readBytes, readUint16, readUint32, readUint8, writeUint8, writeUint16, writeUint32 } from './bytemanip';

export interface ID3Tag {
    id: string,
    flags: number,
    contents: Uint8Array,
}

export interface ID3Tags {
    version: {
        minor: number,
        major: number,
    },
    tags: ID3Tag[],
    flags: number,
}

function readSynchsafeInt32(data: DataView, offset: number): [number, number]{
    let value = 0;
    let byte;
    [byte, offset] = readUint8(data, offset);
    value |= (byte & 0x7F) << 21;
    [byte, offset] = readUint8(data, offset);
    value |= (byte & 0x7F) << 14;
    [byte, offset] = readUint8(data, offset);
    value |= (byte & 0x7F) << 7;
    [byte, offset] = readUint8(data, offset);
    value |= byte & 0x7F;
    return [value, offset];
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function parse(buffer: Uint8Array): ID3Tags{
    const data = new DataView(buffer.buffer);
    let offset = 0;

    // Read header
    let bytes;
    [bytes, offset] = readBytes(data, offset, 3);
    if (String.fromCharCode(...bytes) !== 'ea3') {
        throw new Error("Not an ID3v2 tag");
    }

    let major, minor, flags, size;
    [major, offset] = readUint8(data, offset);
    [minor, offset] = readUint8(data, offset);
    [flags, offset] = readUint8(data, offset);
    [size, offset] = readSynchsafeInt32(data, offset);

    const tags: ID3Tag[] = [];

    // Parse frames
    while (offset < size + 10) {
        let frameId, frameSize, frameFlags, frameContents;
        [frameId, offset] = readBytes(data, offset, 4);
        [frameSize, offset] = readUint32(data, offset);
        [frameFlags, offset] = readUint16(data, offset);
        [frameContents, offset] = readBytes(data, offset, frameSize);

        // Stop if we encounter padding
        if (frameId[0] === 0) {
            break;
        }

        tags.push({
            id: textDecoder.decode(frameId),
            flags: frameFlags,
            contents: frameContents,
        });
    }

    return {
        version: {
            major,
            minor,
        },
        tags,
        flags,
    };
};

function writeSynchsafeInt32(value: number): Uint8Array{
    const array = new Uint8Array(4);
    array[0] = (value >> 21) & 0x7f;
    array[1] = (value >> 14) & 0x7f;
    array[2] = (value >> 7) & 0x7f;
    array[3] = value & 0x7f;
    return array;
};

export function serialize(tags: ID3Tags): Uint8Array{
    const header = new Uint8Array(10);
    header.set(textEncoder.encode('ea3'));
    header.set(writeUint8(tags.version.major), 3);
    header.set(writeUint8(tags.version.minor), 4);
    header.set(writeUint8(tags.flags), 5);

    let size = 0;
    const frames: Uint8Array[] = [];

    for (const tag of tags.tags) {
        const frame = new Uint8Array(10 + tag.contents.length);
        if(tag.id.length !== 4) throw new Error("Invalid TAG ID length!");
        frame.set(textEncoder.encode(tag.id), 0);
        frame.set(writeUint32(tag.contents.length), 4);
        frame.set(writeUint16(tag.flags), 8);
        frame.set(tag.contents, 10);

        frames.push(frame);
        size += frame.length;
    }

    if((size + 10) % 16 !== 0) {
        const diff = 16 - ((size + 10) % 16);
        size += diff;
    }

    header.set(writeSynchsafeInt32(size), 6);

    const result = new Uint8Array(10 + size);
    result.set(header, 0);

    let offset = 10;
    for (const frame of frames) {
        result.set(frame, offset);
        offset += frame.length;
    }

    return result;
};

// TODO: Fix this
export function encodeUTF16BEStringEA3(source: string, includeType = true){
    const utf8 = textEncoder.encode(source);
    const rawArr: number[] = includeType ? [2] : []; // 2 - marker - UTF16BE
    let sequenceRemaining = 0;
    let currentSequence = 0;
    for(let char of utf8){
        if(sequenceRemaining) {
            if((char & (0b10_000000)) !== 0b10_000000) {
                throw new Error("Internal error");
            }
            currentSequence |= (char & 0b00_111111);
            --sequenceRemaining;
            if(!sequenceRemaining) {
                // Push to rawArr;
                const high = (currentSequence & 0xFF00) >> 8;
                const low = currentSequence & 0xFF;
                rawArr.push(high, low);
            }
        } else {
            let i = 0;
            while((char & (1 << (7 - i)))) i++;
            if(i){
                sequenceRemaining = i - 1;
                currentSequence = char & ((1 << (7 - i)) - 1);
                currentSequence <<= 6;
            } else {
                // Normal
                rawArr.push(0, char);
            }
        }
    }
    return new Uint8Array(rawArr);
}
