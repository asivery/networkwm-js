import Crypto from '@originjs/crypto-js-wasm';

import { getBytesPerFrame, getSeconds, HiMDCodec } from "himd-js";
import { concatUint8Arrays, createEA3Header, createRandomBytes, wordArrayToByteArray } from "./utils";
import { encodeUTF16BEStringEA3, ID3Tags, serialize } from "./id3";
import { createTrackKeyForKeyring, createTrackMac2, EKBROOTS } from "./encryption";

const textEncoder = new TextEncoder();

const PHONY_CID = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x0F, 0x50, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xA9, 0xC1, 0x6A, 0x81, 0x6A, 0x87, 0xDA, 0xAD, 0x4B, 0xA2, 0xC5, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const EKB1001D_CONTENTS = new Uint8Array([0x45, 0x4B, 0x42, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x1D, 0x00, 0x00, 0x00, 0x00, 0x39, 0x47, 0xF4, 0x0A, 0x33, 0x65, 0x2F, 0x98, 0x71, 0x73, 0xC3, 0x98, 0x68, 0xC5, 0x23, 0x5B, 0x84, 0x20, 0xC8, 0xCF, 0xFB, 0x0E, 0x7F, 0x4E, 0x00, 0x00, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, 0x34, 0x85, 0x14, 0x51, 0x45, 0x04, 0x02, 0xFF, 0xFE, 0x00, 0x00, 0x00, 0x00, 0x36, 0xD2, 0x00, 0x38, 0x74, 0x91, 0x51, 0x9D, 0xA7, 0x75, 0x94, 0x70, 0xA0, 0x17, 0x69, 0xDA, 0x69, 0x55, 0xAE, 0xA6, 0x9F, 0x6A, 0x3E, 0x69, 0x18, 0xC7, 0xC6, 0xBB, 0xD7, 0xCC, 0xFB, 0x1B, 0x81, 0x8D, 0xA9, 0x97, 0x90, 0x67, 0x29, 0x5C, 0xB7, 0x55, 0x5A, 0xEC, 0x21, 0x1B, 0x9E, 0xBD, 0xD4, 0x7E, 0xD9, 0x09, 0x79, 0xE0, 0x39, 0xA1, 0xE0, 0x76, 0x68, 0x0D, 0xB8, 0xBF, 0xED, 0xB0, 0xD3, 0x24, 0x26, 0xB8, 0xF7, 0x79, 0x22, 0xBD, 0x46, 0xC9, 0x44, 0x9F, 0xDF, 0x01, 0x74, 0xC0, 0x00, 0x00, 0x00, 0x08, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x28, 0xDB, 0x54, 0x6A, 0xC5, 0xE0, 0x4D, 0x4F, 0xCB, 0xF2, 0x46, 0x3B, 0x01, 0xDE, 0x2C, 0xD0, 0xFB, 0xAF, 0x7A, 0xA7, 0x1E, 0xEF, 0x44, 0x29, 0x05, 0x97, 0x9D, 0xBE, 0xE7, 0x28, 0x4E, 0xA4, 0x53, 0x3A, 0x2F, 0x71, 0xC7, 0xCB, 0x86, 0x58, 0x39]);
function encodeSonyWeirdString(type: string, data: string){
    return concatUint8Arrays([
        encodeUTF16BEStringEA3(type),
        new Uint8Array([0, 0]),
        encodeUTF16BEStringEA3(data, false),
    ]);
}

function createSonyGEOB(geobName: string, header: Uint8Array, kvmap: { name: string, contents: Uint8Array, chunkLen: number, chunks: number }[]){
    // Header:
    const dataSlices: Uint8Array[] = [
        new Uint8Array([0x02]),
        textEncoder.encode("binary"),
        new Uint8Array([0, 0, 0]),
        encodeUTF16BEStringEA3(geobName, false),
        new Uint8Array([0, 0]),
        header,
    ];

    // KVs:
    for(let val of kvmap) {
        const name = textEncoder.encode(val.name.padEnd(12, ' '));
        dataSlices.push(
            name, new Uint8Array([0, val.chunkLen, 0, val.chunks]), val.contents,
        );
    }

    return concatUint8Arrays(dataSlices);
}

function createEncryptionHeader(titleInfo: {artist: string, album: string, title: string, genre: string}, milliseconds: number) {
    const verificationKey = createRandomBytes(8);
    const actualTrackKey = createRandomBytes(8);
    // In every KEYRING section, the track key is stored as decrypted by the verification key decrypted by the ekbroot
    const padding = createRandomBytes(8); // What's this???
    const keyringDataA = concatUint8Arrays([
        new Uint8Array([0x00, 0x28, 0x00, 0x01, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x21]), // Use EKB 00010021
        verificationKey, createTrackKeyForKeyring(0x00010021, verificationKey, actualTrackKey), padding,
        new Uint8Array(8).fill(0),
    ]);

    const firstGEOBContents = createSonyGEOB("OMG_ULINF", new Uint8Array(), [
        { name: 'KEYRING', chunkLen: 0x10, chunks: 0x03, contents: keyringDataA },
        { name: '!CID', chunkLen: 0x10, chunks: 0x02, contents: PHONY_CID },
        { name: '!REFID', chunkLen: 0x10, chunks: 0x01, contents: new Uint8Array([0x01, 0x01, 0x03, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])},
        { name: 'PLEASE', chunkLen: 0x10, chunks: 0x02, contents: textEncoder.encode("don't do DRM - it's bad for you.")}
    ]);
    const verificationKeyCA = Crypto.lib.CipherParams.create({
        ciphertext: Crypto.lib.WordArray.create(verificationKey),
    });
    const decryptedVerificationKeyWaA = Crypto.TripleDES.decrypt(verificationKeyCA, Crypto.lib.WordArray.create(EKBROOTS[0x00010021]), { mode: Crypto.mode.ECB });

    const maclistVerifiedData = firstGEOBContents.slice(94); // Offset to '!CID'
    const maclistValue = createTrackMac2(decryptedVerificationKeyWaA, maclistVerifiedData);

    const keyringDataB = concatUint8Arrays([
        new Uint8Array([0x00, 0x28, 0x00, 0x01, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x1D]), // Use EKB 0001001D
        verificationKey, createTrackKeyForKeyring(0x0001001D, verificationKey, actualTrackKey), padding,
        new Uint8Array(8).fill(0),
        EKB1001D_CONTENTS,
    ]);

    let secondGEOBContents = createSonyGEOB("OMG_BKLSI",
        new Uint8Array([0x00, 0x01, 0x00, 0x40, 0x00, 0xDC, 0x00, 0x70, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    [   
        { name: 'KEYRING', chunkLen: 0x10, chunks: 0x03, contents: keyringDataB },
        { name: '!CID', chunkLen: 0x10, chunks: 0x02, contents: PHONY_CID },
        { name: 'SHARE_P_SID', chunkLen: 0x10, chunks: 0x01, contents: new Uint8Array([0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x27, 0xE3, 0x22, 0xB5, 0x46, 0x89, 0xED, 0x10])},
        { name: '!REFID', chunkLen: 0x10, chunks: 0x01, contents: new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x03, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])},
    ]);


    const verificationKeyC = Crypto.lib.CipherParams.create({
        ciphertext: Crypto.lib.WordArray.create(verificationKey),
    });
    const decryptedVerificationKeyWa = Crypto.TripleDES.decrypt(verificationKeyC, Crypto.lib.WordArray.create(EKBROOTS[0x0001001D]), { mode: Crypto.mode.ECB });

    const cbcMac = createTrackMac2(decryptedVerificationKeyWa, secondGEOBContents.subarray(0x14a));

    // Merge the CBC-MAC into the GEOB
    secondGEOBContents = concatUint8Arrays([secondGEOBContents, cbcMac, new Uint8Array(8).fill(0)]);

    const id3Info: ID3Tags = {
        flags: 0,
        version: {major: 3, minor: 0},
        tags: [
            {id: "GEOB", contents: firstGEOBContents, flags: 0}, // OMG_ULINF
            {id: "TIT2", contents: encodeUTF16BEStringEA3(titleInfo.title), flags: 0},
            {id: "TPE1", contents: encodeUTF16BEStringEA3(titleInfo.artist), flags: 0},
            {id: "TALB", contents: encodeUTF16BEStringEA3(titleInfo.album), flags: 0},
            {id: "TALB", contents: encodeUTF16BEStringEA3(titleInfo.album), flags: 0},
            {id: "TCON", contents: encodeUTF16BEStringEA3(titleInfo.genre), flags: 0},
            {id: "TXXX", contents: encodeSonyWeirdString("OMG_TPE1S", titleInfo.artist), flags: 0},
            {id: "TXXX", contents: encodeSonyWeirdString("OMG_TRACK", '0'), flags: 0}, //???
            {id: "TXXX", contents: encodeSonyWeirdString("OMG_ALBMS", titleInfo.album), flags: 0},
            {id: "TXXX", contents: encodeSonyWeirdString("OMG_TIT2S", titleInfo.title), flags: 0},
            {id: "TLEN", contents: encodeUTF16BEStringEA3(milliseconds.toString()), flags: 0},
            {id: "GEOB", contents: secondGEOBContents, flags: 0}, // OMG_BKLSI
        ]
    }

    return { contents: serialize(id3Info), trackEncryptionKey: actualTrackKey, maclistValue };
}

export function createTaggedEncryptedOMA(rawData: Uint8Array, titleInfo: {artist: string, album: string, title: string, genre: string}, codec: {codecId: HiMDCodec, codecInfo: Uint8Array}){
    const formatHeader = createEA3Header(codec, true);
    const milliseconds = Math.floor(1000 * getSeconds(codec, Math.ceil(rawData.length / getBytesPerFrame(codec))));
    const { contents: encHeader, trackEncryptionKey, maclistValue } = createEncryptionHeader(titleInfo, milliseconds);
    let iv = createRandomBytes(8);
    formatHeader.set(iv, formatHeader.length - 8);
    // Encrypt the whole file
    const keyWa = Crypto.lib.WordArray.create(trackEncryptionKey);
    const ivWa = Crypto.lib.WordArray.create(iv);
    const blockWa = Crypto.lib.WordArray.create(rawData);
    const allData = Crypto.DES.encrypt(blockWa, keyWa, { mode: Crypto.mode.CBC, iv: ivWa });
    rawData = wordArrayToByteArray(allData.ciphertext, rawData.length);

    return { data: concatUint8Arrays([encHeader, formatHeader, rawData]), maclistValue, key: milliseconds };
}
