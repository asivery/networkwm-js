import { CodecInfo, HiMDCodec, getCodecName as _getCodecName, getKBPS as _getKBPS } from "himd-js";
import { writeUint16 } from "./bytemanip";

export enum NWCodec {
    MP3 = 0x03,
}

export interface NWCodecInfo{
    codecId: HiMDCodec | NWCodec,
    codecInfo: Uint8Array,
    complete?: boolean,
}

export function createEA3Header({ codecId, codecInfo, complete }: NWCodecInfo, encrypted = 0xFFFF, version = 1) {
    const headerSize = 96;
    const header = new Uint8Array(headerSize);
    header.set(new Uint8Array([0x45, 0x41, 0x33, version, 0x00, 0x60, ...writeUint16(encrypted), 0x00, 0x00, 0x00, 0x00]));
    header[32] = codecId;
    header.set(complete ? codecInfo : codecInfo.slice(0, 3), 33);
    return header;
}

export function getCodecName(codecInfo: NWCodecInfo) {
    if(codecInfo.codecId === NWCodec.MP3) {
        return "MP3";
    }

    return _getCodecName(codecInfo as CodecInfo);
}

export function getKBPS(codecInfo: NWCodecInfo) {
    // FIXME: MP3 KBPS retrieval broken
    if(codecInfo.codecId === NWCodec.MP3) {
        const modifiedCodecInfo = new Uint8Array(codecInfo.codecInfo);
        modifiedCodecInfo[0] |= 0b11;
        return _getKBPS({
            codecInfo: modifiedCodecInfo,
            codecId: HiMDCodec.ATRAC3PLUS_OR_MPEG,
        });
    }
    return _getKBPS(codecInfo as CodecInfo);
}
