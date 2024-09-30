import Crypto from '@originjs/crypto-js-wasm';

import { getBytesPerFrame, getSeconds, HiMDCodec, HiMDFile } from "himd-js";
import { arrayEq, concatUint8Arrays, createRandomBytes, wordArrayToByteArray } from "./utils";
import { encodeUTF16BEStringEA3, ID3Tags, parse, readSynchsafeInt32, serialize, encodeSonyWeirdString, createCommonID3Tags } from "./id3";
import { createTrackKeyForKeyring, createTrackKeyFromKeyring, createTrackMac2, EKBROOTS } from "./encryption";
import { InboundTrackMetadata, TrackMetadata } from './databases';
import { createEA3Header } from './codecs';
const textEncoder = new TextEncoder();

const PHONY_CID = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x0F, 0x50, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xA9, 0xC1, 0x6A, 0x81, 0x6A, 0x87, 0xDA, 0xAD, 0x4B, 0xA2, 0xC5, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const EKB1001D_CONTENTS = new Uint8Array([0x45, 0x4B, 0x42, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x1D, 0x00, 0x00, 0x00, 0x00, 0x39, 0x47, 0xF4, 0x0A, 0x33, 0x65, 0x2F, 0x98, 0x71, 0x73, 0xC3, 0x98, 0x68, 0xC5, 0x23, 0x5B, 0x84, 0x20, 0xC8, 0xCF, 0xFB, 0x0E, 0x7F, 0x4E, 0x00, 0x00, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, 0x34, 0x85, 0x14, 0x51, 0x45, 0x04, 0x02, 0xFF, 0xFE, 0x00, 0x00, 0x00, 0x00, 0x36, 0xD2, 0x00, 0x38, 0x74, 0x91, 0x51, 0x9D, 0xA7, 0x75, 0x94, 0x70, 0xA0, 0x17, 0x69, 0xDA, 0x69, 0x55, 0xAE, 0xA6, 0x9F, 0x6A, 0x3E, 0x69, 0x18, 0xC7, 0xC6, 0xBB, 0xD7, 0xCC, 0xFB, 0x1B, 0x81, 0x8D, 0xA9, 0x97, 0x90, 0x67, 0x29, 0x5C, 0xB7, 0x55, 0x5A, 0xEC, 0x21, 0x1B, 0x9E, 0xBD, 0xD4, 0x7E, 0xD9, 0x09, 0x79, 0xE0, 0x39, 0xA1, 0xE0, 0x76, 0x68, 0x0D, 0xB8, 0xBF, 0xED, 0xB0, 0xD3, 0x24, 0x26, 0xB8, 0xF7, 0x79, 0x22, 0xBD, 0x46, 0xC9, 0x44, 0x9F, 0xDF, 0x01, 0x74, 0xC0, 0x00, 0x00, 0x00, 0x08, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x28, 0xDB, 0x54, 0x6A, 0xC5, 0xE0, 0x4D, 0x4F, 0xCB, 0xF2, 0x46, 0x3B, 0x01, 0xDE, 0x2C, 0xD0, 0xFB, 0xAF, 0x7A, 0xA7, 0x1E, 0xEF, 0x44, 0x29, 0x05, 0x97, 0x9D, 0xBE, 0xE7, 0x28, 0x4E, 0xA4, 0x53, 0x3A, 0x2F, 0x71, 0xC7, 0xCB, 0x86, 0x58, 0x39]);
const ULINF_KEYRING_HEADER = new Uint8Array([
    0x00, 0x28, 0x00, 0x01,
    0x00, 0x03, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x00, 0x21,
]);

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

function createEncryptionHeader(titleInfo: InboundTrackMetadata, milliseconds: number) {
    const verificationKey = createRandomBytes(8);
    const actualTrackKey = createRandomBytes(8);
    // In every KEYRING section, the track key is stored as decrypted by the verification key decrypted by the ekbroot
    const padding = createRandomBytes(8); // What's this???
    const keyringDataA = concatUint8Arrays([
        ULINF_KEYRING_HEADER, // Use EKB 00010021
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
            ...createCommonID3Tags(titleInfo),
            {id: "TLEN", contents: encodeUTF16BEStringEA3(milliseconds.toString()), flags: 0},
            {id: "GEOB", contents: secondGEOBContents, flags: 0}, // OMG_BKLSI
        ]
    }

    return { contents: serialize(id3Info), trackEncryptionKey: actualTrackKey, maclistValue };
}

export function createTaggedEncryptedOMA(rawData: Uint8Array, titleInfo: InboundTrackMetadata, codec: {codecId: HiMDCodec, codecInfo: Uint8Array}){
    const formatHeader = createEA3Header(codec, 0x0001);
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

    return { data: concatUint8Arrays([encHeader, formatHeader, rawData]), maclistValue, duration: milliseconds };
}

function findInMetadata(metadata: ID3Tags, id: string, asGeob: boolean) {
    if(!asGeob) return metadata.tags.find(e => e.id === id);
    return metadata.tags.filter(e => e.id === "GEOB")
        .find(e => {
            if(e.contents[0] !== 0x02) return false;
            // This is a valid Sony crypto block
            for(let i = 0; i<id.length * 2; i += 2) {
                if(e.contents[i + 11] !== id.charCodeAt(i / 2)) return false;
            }
            return true;
        });
}

export async function updateMetadata(file: HiMDFile, titleInfo: TrackMetadata) {
    // Read the first 10 bytes to get the encryption header's size.
    const ea3Header = await file.read(10);
    if(ea3Header.length !== 10) throw new Error("Invalid header");
    const headerSizeRemaining = readSynchsafeInt32(new DataView(ea3Header.buffer), 6)[0];
    const fullEncryptionHeader = concatUint8Arrays([ea3Header, await file.read(headerSizeRemaining)]);
    const subsequentData = await file.read();
    const metadata = parse(fullEncryptionHeader);
    const tlen = findInMetadata(metadata, "TLEN", false);
    const ulinf = findInMetadata(metadata, "OMG_ULINF", true);
    const bklsi = findInMetadata(metadata, "OMG_BKLSI", true);

    if(!ulinf || !bklsi || !tlen) throw new Error("Not a valid encrypted OMA");

    const newMetadataBlock: ID3Tags = {
        flags: metadata.flags,
        version: metadata.version,
        tags: [
            ulinf,
            ...createCommonID3Tags(titleInfo),
            tlen,
            bklsi,
        ]
    };
    const serialized = serialize(newMetadataBlock);
    // Rewrite the file
    const zeroOutDifference = Math.max(0, fullEncryptionHeader.length - serialized.length);
    await file.seek(0);
    await file.write(serialized);
    await file.write(subsequentData);
    await file.write(new Uint8Array(zeroOutDifference).fill(0));
}

export function decryptOMA(omaFile: Uint8Array): Uint8Array {
    const OMA_METADATA_HEADER = textEncoder.encode("ea3");
    if(!arrayEq(OMA_METADATA_HEADER, omaFile.subarray(0, 3))) {
        throw new Error("Not a valid OMA file");
    }
    const metaHeaderSize = 10 + readSynchsafeInt32(new DataView(omaFile.buffer), 6)[0];
    const metadata = parse(omaFile.subarray(0, metaHeaderSize));
    const textDecoder = new TextDecoder();
    const ulinf = findInMetadata(metadata, "OMG_ULINF", true)?.contents;
    let dataOffset = 10 + 'OMG_ULINF'.length * 2 + 2;
    let keyringContents = null;
    if(!ulinf) throw new Error("No ULINF GEOB found!");
    while((dataOffset + 16) < ulinf.length) {
        let name = textDecoder.decode(ulinf.subarray(dataOffset, dataOffset + 12)).trim();
        let chunkLen = ulinf[dataOffset + 13];
        let chunkCount = ulinf[dataOffset + 15];
        if(name.includes("\x00")) {
            name = name.substring(0, name.indexOf("\x00"));
        }
        if(name !== 'KEYRING') {
            dataOffset += 16 + (chunkCount * chunkLen);
            continue;
        }
        keyringContents = ulinf.subarray(dataOffset + 16, dataOffset + 16 + (chunkCount * chunkLen));
        break;
    }
    if(!keyringContents) throw new Error("Cannot find KEYRING in ULINF!");
    if(!arrayEq(ULINF_KEYRING_HEADER, keyringContents.subarray(0, ULINF_KEYRING_HEADER.length))) throw new Error("Invalid ULINF KEYRING header");
    const encryptedVerificationKey = keyringContents.slice(16, 16 + 8);
    const encryptedTrackKey = keyringContents.slice(24, 24 + 8);
    const decryptedTrackKey = createTrackKeyFromKeyring(0x00010021, encryptedVerificationKey, encryptedTrackKey);

    // We have the key now. Recreate the headers and form the final file.
    // Strip all DRM tags:
    metadata.tags = metadata.tags.filter(e => e.id !== "GEOB");
    const newMetaHeader = serialize(metadata);
    const newFormatHeader = omaFile.slice(metaHeaderSize, metaHeaderSize + 96);
    // Set encryption type to 0xFFFF (unencrypted)
    newFormatHeader[6] = 0xFF;
    newFormatHeader[7] = 0xFF;
    // Retrieve IV from the header
    const iv = newFormatHeader.slice(96 - 8);
    // ...and destroy it
    newFormatHeader.fill(0, 96 - 8);

    // Finally, decrypt all the audio
    const rawData = omaFile.subarray(metaHeaderSize + 96);
    const keyWa = Crypto.lib.WordArray.create(decryptedTrackKey);
    const ivWa = Crypto.lib.WordArray.create(iv);
    const blockWa = Crypto.lib.CipherParams.create({
        ciphertext: Crypto.lib.WordArray.create(rawData)
    });
    const allData = Crypto.DES.decrypt(blockWa, keyWa, { mode: Crypto.mode.CBC, iv: ivWa });
    const decryptedAudio = wordArrayToByteArray(allData, rawData.length);

    // And merge all into the final OMA.
    return concatUint8Arrays([newMetaHeader, newFormatHeader, decryptedAudio]);
}
