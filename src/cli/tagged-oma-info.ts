import fs from 'fs';
import { arrayEq, concatUint8Arrays, hexDump as _hexDump, Logger } from '../utils';
import { parse, readSynchsafeInt32 } from '../id3';
import { getCodecName, getKBPS } from 'himd-js';
import { deriveMP3ParametersFromOMA } from '../derive-mp3-key';

let hexDumpAll = false;

const logger = new Logger();
const log = logger.log.bind(logger);
const bumpIndent = logger.bumpIndent.bind(logger);
const hexDump = _hexDump.bind(null, log);

const textDecoder = new TextDecoder();

const utf16Decoder = new TextDecoder("UTF-16BE");
function parseEncryptionHeader(contents: Uint8Array, offset: number) {
    log("Encryption header (main ID3 header):");
    bumpIndent(1);
    const ea3Header = contents.subarray(offset, offset + 10);
    const headerSizeRemaining = readSynchsafeInt32(new DataView(ea3Header.buffer), 6)[0];
    const fullEncryptionHeader = concatUint8Arrays([ea3Header, contents.subarray(offset + 10, offset + 10 + headerSizeRemaining)]);
    const metadata = parse(fullEncryptionHeader);
    log(`Version: ${metadata.version.major}.${metadata.version.minor}`);
    log(`Flags: ${metadata.flags}`);
    log(`Tags:`);
    bumpIndent(1);
    for(const tag of metadata.tags) {
        if(tag.id === "GEOB") {
            log("Sony GEOB DRM tag");
            bumpIndent(1);
            const HEADER_LENGTHS: {[key: string]: number} = {
                OMG_BKLSI: 0x10,
                OMG_ULINF: 0,
                OMG_OLINF: -1,
            };
            const geob = tag.contents;
            if(!(
                geob[0] === 2 &&
                arrayEq(geob.subarray(1, 1 + 6), textEncoder.encode("binary")) &&
                arrayEq(geob.subarray(1 + 6, 1 + 6 + 3), Array(3).fill(0))
            )) {
                log("Invalid GLOB contents! Raw data below:");
                hexDump(geob);
                bumpIndent(-1);
                continue
            }
            let geobName = utf16Decoder.decode(geob.subarray(10, 50));
            const offset = geobName.indexOf("\x00");
            geobName = geobName.substring(0, offset);
            let dataOffset = 10 + offset * 2 + 2;
            log(`Name: ${geobName}`);
            let headerLength = HEADER_LENGTHS[geobName];
            if(headerLength === -1) headerLength = geob.length - dataOffset;
            if(headerLength === undefined) {
                log("[!] Warning: Undefined header length for this tag. Assuming 0");
                headerLength = 0;
            }
            const headerData = geob.subarray(dataOffset, dataOffset + headerLength);
            log("Header:");
            bumpIndent(1);
            hexDump(headerData);
            dataOffset += headerLength;
            bumpIndent(-1);
            log("Contents:")
            bumpIndent(1);
            if(!((dataOffset + 16) < geob.length)) log("<None>");
            while((dataOffset + 16) < geob.length) {
                let name = textDecoder.decode(geob.subarray(dataOffset, dataOffset + 12));
                let chunkLen = geob[dataOffset + 13];
                let chunkCount = geob[dataOffset + 15];
                if(name.includes("\x00")) {
                    name = name.substring(0, name.indexOf("\x00"));
                }
                if(name === "EKB ") {
                    log("[!]: Special");
                    chunkCount = 1;
                    chunkLen = 204;
                }
                const data = geob.subarray(dataOffset + 16, dataOffset + 16 + (chunkCount * chunkLen));
                log(`${name} - Stored in ${chunkCount} ${chunkLen}-byte long chunks:`);
                bumpIndent(1);
                hexDump(data);
                bumpIndent(-1);
                dataOffset += 16 + data.length;
            }
            bumpIndent(-2);
        } else {
            if(tag.contents[0] === 2) {
                const rootName = tag.contents.subarray(1);
                let stringValue = utf16Decoder.decode(rootName);
                if(stringValue.includes("\x00")){
                    stringValue = stringValue.substring(0, stringValue.indexOf("\x00"));
                }
                if((stringValue.length * 2) !== rootName.length) {
                    const value = rootName.subarray(stringValue.length * 2 + 2);
                    const stringValue2 = utf16Decoder.decode(value);
                    log(`${tag.id}<Container>: ${stringValue}: ${stringValue2} <${tag.flags}>`)
                } else {
                    log(`${tag.id}: ${stringValue} <${tag.flags}>`);
                }
            } else log(`${tag.id}: <Unknown data> <${tag.flags}>`);
            if(hexDumpAll) {
                bumpIndent(1);
                hexDump(tag.contents);
                bumpIndent(-1);
            }
        }
    }
    bumpIndent(-2);
    return fullEncryptionHeader.length;
}

function parseFormatHeader(contents: Uint8Array, offset: number) {
    const length = 96;
    log("EA3 format header:");
    bumpIndent(1);
    const data = contents.subarray(offset, offset + length);
    const prologue = data.subarray(0, 6);
    const PROLOGUE_VALID = new Uint8Array([0x45, 0x41, 0x33, 0x01, 0x00, 0x60]);
    const PROLOGUE_VALID_MP3 = new Uint8Array([0x45, 0x41, 0x33, 0x02, 0x00, 0x60]);
    const epilogue = data.subarray(8, 12);
    const EPILOGUE_VALID = new Uint8Array([0, 0, 0, 0]);
    if(!arrayEq(EPILOGUE_VALID, epilogue) || !(arrayEq(PROLOGUE_VALID, prologue) || arrayEq(PROLOGUE_VALID_MP3, prologue))){
        log("Invalid data found in EA3 format header. Raw data:");
        bumpIndent(1);
        hexDump(data);
        bumpIndent(-2);
        return length;
    }
    const encryptedFlags = (data[6] << 8) | data[7];
    if(encryptedFlags === 0xFFFF) {
        log("File is not encrypted");
    } else {
        log(`File is encrypted using method ${encryptedFlags}`);
    };
    let codecInfo = new Uint8Array([0,0,0]);
    let codecId = data[32];
    codecInfo[0] = data[33];
    codecInfo[1] = data[34];
    codecInfo[2] = data[35];
    if(codecId === 3) {
        // MP3
        log(`Codec: MP3`);
        const derivedParams = deriveMP3ParametersFromOMA(new Uint8Array([codecId, ...codecInfo]));
        for(const [k, v] of Object.entries(derivedParams)) {
            log(`${k}: ${v.toString(2)}`);
        }
        bumpIndent(-1);
        return length;
    }
    const codecInfoStruct = { codecId, codecInfo };
    log(`Codec: ${getCodecName(codecInfoStruct)}`);
    log(`Bitrate: ${getKBPS(codecInfoStruct)}kbps`);
    bumpIndent(-1);
    return length;
}

const textEncoder = new TextEncoder();
const ENCRYPTION_HEADER_START = textEncoder.encode("ea3");
const FORMAT_HEADER_START = textEncoder.encode("EA3");
export function main(invocation: string, args: string[]) {
    const file = args[0];
    if(!file) {
        console.log(`Usage: ${invocation} <OMA file> [hex-dump-all]`)
        return;
    }
    const contents = new Uint8Array(fs.readFileSync(file));
    let offset = 0;
    if(args[1] === 'hex-dump-all') hexDumpAll = true;
    while(offset < contents.length) {
        const headerStart = contents.subarray(offset, offset + 3);
        if(arrayEq(headerStart, ENCRYPTION_HEADER_START)) {
            offset += parseEncryptionHeader(contents, offset);
        } else if(arrayEq(headerStart, FORMAT_HEADER_START)) {
            offset += parseFormatHeader(contents, offset);
        } else {
            console.log("<Audio data>");
            break;
        }
    }
}
