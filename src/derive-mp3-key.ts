import { getUint32 } from "./bytemanip";
import { getMP3EncryptionKey } from "./encryption";
import { readSynchsafeInt32 } from "./id3";
import { arrayEq, concatUint8Arrays } from "./utils";

const textEncoder = new TextEncoder();

const ENCRYPTION_HEADER_START = textEncoder.encode("ea3");
const FORMAT_HEADER_START = textEncoder.encode("EA3");

export function deriveMP3ParametersFromOMA(mp3CodecInfo: Uint8Array) {
    if(mp3CodecInfo[0] !== 3) throw new Error("Not an MP3 format tag");
    const flags = mp3CodecInfo[1];
    const cmb0 = mp3CodecInfo[2];
    const cmb1 = mp3CodecInfo[3];

    const version = (cmb0 >> 6) & 3;
    const layer = (cmb0 >> 4) & 3;
    const bitrate = cmb0 & 15;
    const sample = (cmb1 >> 6) & 3;
    const chmod = (cmb1 >> 4) & 3;
    const preemp = (cmb1 >> 2) & 3;

    return { version, layer, bitrate, sample, chmod, preemp, flags };
}

export function deriveMP3TrackKey(rawFile: Uint8Array, callback?: (state: 'genFrames' | 'genKeys' | 'commonness', progress: number, outOf: number) => void): number {
    // Make sure we're dealing with an MP3 OMA file
    let offset = 0;
    let headerStart = rawFile.subarray(offset, offset + 3);
    // Assume first is the tag header
    if(!arrayEq(headerStart, ENCRYPTION_HEADER_START)) throw new Error("Expected metadata header");
    const headerSizeRemaining = readSynchsafeInt32(new DataView(rawFile.buffer), 6)[0];
    offset = 10 + headerSizeRemaining;

    headerStart = rawFile.subarray(offset, offset + 3);
    const rawDataView = new DataView(rawFile.buffer);
    if(!arrayEq(headerStart, FORMAT_HEADER_START)) throw new Error("Expected format header");
    const mp3CodecInfo = rawFile.subarray(offset + 32, offset + 32 + 5);
    if(rawFile[offset + 6] !== 0xFF || rawFile[offset + 7] !== 0xFE) throw new Error("OMA is not LeafID-XOR encoded!");
    const { version, layer, bitrate, sample, chmod, preemp } = deriveMP3ParametersFromOMA(mp3CodecInfo);
    const audioStartOffset = offset + 96;
    const fourByteChunks = [];
    for(let i = audioStartOffset; i < rawFile.length - 3; i += 4){
        fourByteChunks.push(rawDataView.getUint32(i) >>> 0);
    }

    function formHeader(variantIteration: number){
        const assumeCrc =  !!(variantIteration & 0b0100_0000);
        const assumePadding =  !!(variantIteration & 0b0010_0000);
        const assumePrivate =  !!(variantIteration & 0b0001_0000);
        const assumeOriginalMedia =  !!(variantIteration & 0b0000_1000);
        const assumeCopyright =  !!(variantIteration & 0b0000_0100);
        const assumeJointstereoExtinfo = variantIteration & 3;

        const int = (e: boolean) => e ? 1 : 0;
        const rootFrameHeader = new Uint8Array([
            0xFF,
            (7 << 5) | (version << 3) | (layer << 1) | int(assumeCrc),
            (bitrate << 4) | (sample << 2) | (int(assumePadding) << 1) | int(assumePrivate),
            (chmod << 6) | (assumeJointstereoExtinfo << 4) | (int(assumeCopyright) << 3) | (int(assumeOriginalMedia) << 2) | (preemp)
        ]);

        return rootFrameHeader;
    }
    const firstXoredHeader = fourByteChunks[0];

    const allFirstFrames = Array(128).fill(0).map((_, i) => getUint32(formHeader(i)));
    callback?.('genFrames', -1, -1);
    const allKeys = allFirstFrames.map(r => (firstXoredHeader ^ r) >>> 0);
    callback?.('genKeys', -1, -1);
    const commonness = [];

    for(let keyI = 0; keyI < allKeys.length; keyI++) {
        const key = allKeys[keyI];
        // Zero should be dominant in the MP3 file => The most common key present as plaintext in the file will be valid
        let z = 0;
        for(let chunk of fourByteChunks){
            if(chunk === key) ++z;
        }
        commonness.push(z);
        callback?.('commonness', keyI, allKeys.length);
    }
    // Find the most common key
    const matchedKey = allKeys[commonness.indexOf(Math.max(...commonness))];

    return matchedKey;
}

export function decryptMP3(fullFile: Uint8Array, fileId: number, deviceKey?: number, callback?: (state: 'genFrames' | 'genKeys' | 'commonness' | 'decrypt', progress: number, of: number) => void){
    const trackKey = (deviceKey ? getMP3EncryptionKey(deviceKey, fileId) : deriveMP3TrackKey(fullFile, callback ? (s, p) => callback(s, p, 127) : undefined)) >>> 0;

    // Make sure we're dealing with an MP3 OMA file
    let offset = 0;
    let headerStart = fullFile.subarray(offset, offset + 3);
    // Assume first is the tag header
    if(!arrayEq(headerStart, ENCRYPTION_HEADER_START)) throw new Error("Expected metadata header");
    const headerSizeRemaining = readSynchsafeInt32(new DataView(fullFile.buffer), 6)[0];
    offset = 10 + headerSizeRemaining;

    // Reconstruct the ID3 header and decrypt the audio - it starts 96 bytes after the end of the ID3 header
    const data = concatUint8Arrays([fullFile.subarray(0, offset), fullFile.subarray(offset + 96, fullFile.length)]);
    data.set(textEncoder.encode("ID3"), 0);
    const dataView = new DataView(data.buffer);

    for(offset; offset < data.length - 7; offset += 8){
        // 8-byte-long block processing on 4-byte-long key
        // Ok Sony.
        dataView.setUint32(offset, (dataView.getUint32(offset) ^ trackKey) >>> 0);
        dataView.setUint32(offset + 4, (dataView.getUint32(offset + 4) ^ trackKey) >>> 0);
        callback?.('decrypt', offset, data.length);
    }

    return data;
}
