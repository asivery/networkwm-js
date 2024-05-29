import Crypto from '@originjs/crypto-js-wasm';
import { getUint32, readUint32, writeUint32 } from './bytemanip';
import { NWJSError } from './errors';
import { wordArrayToByteArray } from './utils';

export async function initCrypto() {
    await Crypto.TripleDES.loadWasm();
    await Crypto.DES.loadWasm();
}

// prettier-ignore
export const EKBROOTS: { [key: number]: Uint8Array } = {
    // <Redacted>
} as const;

export function importKeys(rawKeysContents: Uint8Array){
    let offset = 0;
    const dataView = new DataView(rawKeysContents.buffer);
    while(offset < rawKeysContents.length){
        let ekbid;
        [ekbid, offset] = readUint32(dataView, offset);
        EKBROOTS[ekbid] = rawKeysContents.slice(offset, offset += 3 * 8);
    }
}

export function getMP3EncryptionKey(discId: Uint8Array, trackNumber: number) {
    const key = (trackNumber * 0x6953b2ed + 0x6baab1) ^ getUint32(discId, 12);
    return writeUint32(key)
}

export function createTrackKeyForKeyring(ekbNum: number, verificationKey: Uint8Array, trackKey: Uint8Array) {
    if (!(ekbNum in EKBROOTS)) {
        throw new NWJSError('Requested decription with an unknown EKB');
    }
    const rootKeyC = Crypto.lib.WordArray.create(EKBROOTS[ekbNum]);
    const verificationKeyC = Crypto.lib.CipherParams.create({
        ciphertext: Crypto.lib.WordArray.create(verificationKey),
    });
    const trackKeyC = Crypto.lib.CipherParams.create({
        ciphertext: Crypto.lib.WordArray.create(trackKey),
    });

    // Step 1: get real verification key
    const decryptedVerificationKey = Crypto.TripleDES.decrypt(verificationKeyC, rootKeyC, {
        mode: Crypto.mode.ECB,
    });

    // Step 2: get "encrypted" track key - so decrypt it
    const decryptedTrackKey = Crypto.TripleDES.decrypt(trackKeyC, decryptedVerificationKey, {
        mode: Crypto.mode.ECB,
    });
    return wordArrayToByteArray(decryptedTrackKey, 8);
}

export function createMaclistValue(ekbNum: number, verificationKey: Uint8Array, contents: Uint8Array) {
    if (!(ekbNum in EKBROOTS)) {
        throw new NWJSError('Requested decription with an unknown EKB');
    }
    const rootKeyC = Crypto.lib.WordArray.create(EKBROOTS[ekbNum]);
    const verificationKeyC = Crypto.lib.CipherParams.create({
        ciphertext: Crypto.lib.WordArray.create(verificationKey),
    });

    // Step 1: get real verification key
    const decryptedVerificationKey = Crypto.TripleDES.decrypt(verificationKeyC, rootKeyC, {
        mode: Crypto.mode.ECB,
    });

    return createTrackMac2(decryptedVerificationKey, contents);
}

const NO_PADDING = { pad: (a: any) => a, unpad: (a: any) => a };

export function retailMac(message: Uint8Array, key: Uint8Array) {
    const keyA = key.subarray(0, 8);
    const keyB = key.subarray(8, 16);
    const messageWa = Crypto.lib.WordArray.create(message);
    const keyAWa = Crypto.lib.WordArray.create(keyA);
    const keyBWa = Crypto.lib.WordArray.create(keyB);
    const zeroWa = Crypto.lib.WordArray.create(new Uint8Array(8).fill(0));
    const encA = Crypto.DES.encrypt(messageWa, keyAWa, { padding: NO_PADDING, mode: Crypto.mode.CBC, iv: zeroWa }).ciphertext;
    const messageBFull = wordArrayToByteArray(encA);
    const messageB = messageBFull.subarray(messageBFull.length - 8);
    const messageBWa = Crypto.lib.CipherParams.create({
        ciphertext: Crypto.lib.WordArray.create(messageB),
    });
    const encB = Crypto.DES.decrypt(messageBWa, keyBWa, { padding: NO_PADDING, mode: Crypto.mode.ECB });
    const final = Crypto.DES.encrypt(encB, keyAWa, { padding: NO_PADDING, mode: Crypto.mode.ECB }).ciphertext;
    return wordArrayToByteArray(final);
}

export function createIcvMac(icvAndHeader: Uint8Array, sessionKey: Uint8Array) {
    const icvWa = Crypto.lib.WordArray.create(icvAndHeader);
    const sessionKeyWa = Crypto.lib.WordArray.create(sessionKey);
    const zeroWa = Crypto.lib.WordArray.create(new Uint8Array(8).fill(0));
    const result = Crypto.DES.encrypt(icvWa, sessionKeyWa, { mode: Crypto.mode.CBC, iv: zeroWa, padding: NO_PADDING });
    return wordArrayToByteArray(result.ciphertext).subarray(-8);
}

export function encryptTrackKey(trackKey: Uint8Array) {
    const trackKeyWa = Crypto.lib.WordArray.create(trackKey);
    const keyWa = Crypto.lib.WordArray.create(EKBROOTS[0x00010012]);
    const encrypted = Crypto.TripleDES.encrypt(trackKeyWa, keyWa, { mode: Crypto.mode.ECB, padding: NO_PADDING });
    return wordArrayToByteArray(encrypted.ciphertext);
}

export function createTrackMac2(trackKeyWa: Crypto.lib.WordArray, trackEntry: Uint8Array) {
    const trackEntryWa = Crypto.lib.WordArray.create(trackEntry);

    const macKeySourceWa = Crypto.lib.WordArray.create(new Uint8Array(8).fill(0));
    const macKey = Crypto.DES.encrypt(macKeySourceWa, trackKeyWa, { mode: Crypto.mode.ECB, padding: NO_PADDING }).ciphertext;
    const zeroWa = Crypto.lib.WordArray.create(new Uint8Array(8).fill(0));
    const mac = Crypto.DES.encrypt(trackEntryWa, macKey, { mode: Crypto.mode.CBC, iv: zeroWa, padding: NO_PADDING });
    return wordArrayToByteArray(mac.ciphertext).subarray(-8);
}

export function createTrackMac(trackKey: Uint8Array, trackEntry: Uint8Array) {
    const trackKeyWa = Crypto.lib.WordArray.create(trackKey);
    return createTrackMac2(trackKeyWa, trackEntry);
}

export function desDecrypt(data: Uint8Array, key: Uint8Array){
    return wordArrayToByteArray(Crypto.TripleDES.decrypt(Crypto.lib.CipherParams.create({ ciphertext: Crypto.lib.WordArray.create(data) }), Crypto.lib.WordArray.create(key), { mode: Crypto.mode.ECB, iv: Crypto.lib.WordArray.create(new Uint8Array(8).fill(0)) }), data.length);
}
