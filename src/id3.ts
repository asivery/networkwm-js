import { readBytes, readUint16, readUint32, readUint8, writeUint8, writeUint16, writeUint32 } from './bytemanip';
import { InboundTrackMetadata, TrackMetadata } from './databases';
import { concatUint8Arrays } from './utils';

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

export function readSynchsafeInt32(data: DataView, offset: number): [number, number]{
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

export function readInitialID3Header(buffer: Uint8Array): { major: number, minor: number, flags: number, size: number }{
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
    return { major, minor, size, flags };
}

export function parse(buffer: Uint8Array): ID3Tags & { size: number } {
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
    while (offset < size) {
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
        size,
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

export function serialize(tags: ID3Tags, constSize?: number): Uint8Array{
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

    if(constSize !== undefined) {
        if(size > constSize) {
            throw new Error("Too much data to encode!");
        }
        size = constSize;
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

export function encodeUTF16BEStringEA3(source: string, includeType = true) {
    const rawArr: number[] = includeType ? [2] : []; // 2 - marker - UTF16BE

    for (let i = 0; i < source.length; i++) {
        let codePoint = source.charCodeAt(i);

        if (codePoint >= 0xD800 && codePoint <= 0xDBFF) {
            // This is a high surrogate, so we need to get the next character and form the full code point.
            const highSurrogate = codePoint;
            const lowSurrogate = source.charCodeAt(++i);

            if (lowSurrogate < 0xDC00 || lowSurrogate > 0xDFFF) {
                throw new Error("Invalid surrogate pair");
            }

            codePoint = 0x10000 + ((highSurrogate - 0xD800) << 10) + (lowSurrogate - 0xDC00);
        }

        if (codePoint <= 0xFFFF) {
            // Encode as two-byte UTF-16BE
            rawArr.push((codePoint >> 8) & 0xFF, codePoint & 0xFF);
        } else {
            // Encode as surrogate pair
            codePoint -= 0x10000;
            const highSurrogate = 0xD800 | (codePoint >> 10);
            const lowSurrogate = 0xDC00 | (codePoint & 0x3FF);
            rawArr.push((highSurrogate >> 8) & 0xFF, highSurrogate & 0xFF);
            rawArr.push((lowSurrogate >> 8) & 0xFF, lowSurrogate & 0xFF);
        }
    }

    return new Uint8Array(rawArr);
}

export function encodeSonyWeirdString(type: string, data: string){
    return concatUint8Arrays([
        encodeUTF16BEStringEA3(type),
        new Uint8Array([0, 0]),
        encodeUTF16BEStringEA3(data, false),
    ]);
}

export function createCommonID3Tags(titleInfo: InboundTrackMetadata) {
    return [
        {id: "TIT2", contents: encodeUTF16BEStringEA3(titleInfo.title), flags: 0},
        {id: "TPE1", contents: encodeUTF16BEStringEA3(titleInfo.artist), flags: 0},
        {id: "TALB", contents: encodeUTF16BEStringEA3(titleInfo.album), flags: 0},
        {id: "TALB", contents: encodeUTF16BEStringEA3(titleInfo.album), flags: 0},
        {id: "TCON", contents: encodeUTF16BEStringEA3(titleInfo.genre), flags: 0},
        {id: "TXXX", contents: encodeSonyWeirdString("OMG_TPE1S", titleInfo.artist), flags: 0},
        {id: "TXXX", contents: encodeSonyWeirdString("OMG_TRACK", (titleInfo.trackNumber ?? 0) + ''), flags: 0},
        {id: "TXXX", contents: encodeSonyWeirdString("OMG_ALBMS", titleInfo.album), flags: 0},
        {id: "TXXX", contents: encodeSonyWeirdString("OMG_TIT2S", titleInfo.title), flags: 0},
    ]
}
