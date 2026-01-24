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

export function concatUint8Arrays(args: Uint8Array<ArrayBuffer>[]) {
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
export function hexDump(logger: (e: string) => void, data: Uint8Array, truncate = true) {
    if(data.length === 0) logger("<None>");
    let rows = Math.ceil(data.length / 16),
        truncated = false;
    if(truncate && rows > 20) {
        rows = 20;
        truncated = true;
    }
    for(let row = 0; row < rows; row++) {
        const rowData = data.subarray(row * 16, (row + 1) * 16);
        logger(`${(row * 16).toString(16).padStart(4, '0')}:\t${Array.from(rowData).map(e => e.toString(16).padStart(2, '0')).join(' ')}\t${textDecoder.decode(rowData.map(e => e > 0x20 && e < 0x7F ? e : 46))}`);
    }
    if(truncated) logger("<truncated>");
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

export function getAudioDataFromWave(waveFile: Uint8Array) {
    const dv = new DataView(waveFile.buffer);
    const magic = textDecoder.decode(waveFile.slice(0, 4));
    if(magic != 'RIFF') throw new Error("Not a valid RIFF wave file!");
    let cursor = 0x0c;
    while(cursor < waveFile.length) {
        let name = textDecoder.decode(waveFile.slice(cursor, cursor + 4));
        cursor += 4;
        let size = dv.getUint32(cursor, true);
        cursor += 4;
        if(name != 'data') cursor += size;
        else {
            return waveFile.slice(cursor, cursor + size);
        }
    }
    return null;
}

export function resolvePathFromGlobalIndex(globalTrackIndex: number){
    return join('OMGAUDIO', `10F${(globalTrackIndex >> 8).toString(16).padStart(2, '0')}`, '1000' + globalTrackIndex.toString(16).padStart(4, '0').toUpperCase() + '.OMA');
}
