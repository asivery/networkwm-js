import { CodecInfo } from 'himd-js';

export function assert(condition: boolean, message?: string) {
    if (condition) {
        return;
    }
    message = message || 'no message provided';
    throw new Error(`Assertion failed: ${message}`);
}

export function join(...paths: string[]){
    return paths.join("/").replace(/\/*/, '/');
}

export function concatUint8Arrays(args: Uint8Array[]) {
    let totalLength = 0;
    for (let a of args) {
        totalLength += a.length;
    }

    let res = new Uint8Array(totalLength);

    let offset = 0;
    for (let a of args) {
        res.set(a, offset);
        offset += a.length;
    }
    return res;
}

export function createEA3Header({ codecId, codecInfo }: CodecInfo, encrypted = false) {
    const headerSize = 96;
    const header = new Uint8Array(headerSize);
    header.set(new Uint8Array([0x45, 0x41, 0x33, 0x01, 0x00, 0x60, encrypted ? 0x00 : 0xff, encrypted ? 0x01 : 0xff, 0x00, 0x00, 0x00, 0x00]));
    header[32] = codecId;
    header[33] = codecInfo[0];
    header[34] = codecInfo[1];
    header[35] = codecInfo[2];
    return header;
}

function wordToByteArray(word: number, length: number, littleEndian = false) {
    let ba = [],
        xFF = 0xff;
    let actualLength = length;
    if (littleEndian) {
        length = 4;
    }
    if (length > 0) ba.push(word >>> 24);
    if (length > 1) ba.push((word >>> 16) & xFF);
    if (length > 2) ba.push((word >>> 8) & xFF);
    if (length > 3) ba.push(word & xFF);
    if (littleEndian) {
        ba = ba.splice(4 - actualLength).reverse();
    }
    return ba;
}

export function wordArrayToByteArray(wordArray: any, length: number = wordArray.sigBytes) {
    let res = new Uint8Array(length);
    let bytes;
    let i = 0;
    let offset = 0;
    while (length > 0) {
        bytes = wordToByteArray(wordArray.words[i], Math.min(4, length));
        res.set(bytes, offset);
        length -= bytes.length;
        offset += bytes.length;
        i++;
    }
    return res;
}

export function createRandomBytes(length = 8) {
    return new Uint8Array(
        Array(length)
            .fill(0)
            .map(() => Math.floor(Math.random() * 256))
    );
}

export function arrayEq<T>(a: ArrayLike<T>, b: ArrayLike<T>) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

const textDecoder = new TextDecoder();
export function hexDump(logger: (e: string) => void, data: Uint8Array) {
    if(data.length === 0) logger("<None>");
    for(let row = 0; row < Math.ceil(data.length / 16); row++) {
        const rowData = data.subarray(row * 16, (row + 1) * 16);
        logger(`${(row * 16).toString(16).padStart(4, '0')}:\t${Array.from(rowData).map(e => e.toString(16).padStart(2, '0')).join(' ')}\t${textDecoder.decode(rowData.map(e => e > 0x20 && e < 0x7F ? e : 46))}`);
    }
}

export class Logger {
    preffix = "";
    bumpIndent(i: number) {
        if(i < 0) {
            this.preffix = this.preffix.substring(0, this.preffix.length + i * 4);
        } else {
            this.preffix = this.preffix + " ".repeat(4 * i);
        }
    }
    
    log(...data: string[]){
        console.log(this.preffix + data.join(' '));
    }
}
