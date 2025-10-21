import fs from 'fs';
import { createTaggedEncryptedOMA, decryptOMA } from '../tagged-oma';
import { InboundTrackMetadata } from '../databases';
import { generateCodecInfo, HiMDKBPSToFrameSize } from 'himd-js';
import { getAudioDataFromWave } from '../utils';
import { importKeys, initCrypto } from '../encryption';
import { join } from 'path';

export async function main(invocation: string, args: string[]){
    if(args.length < 2) {
        console.log(`Usage: ${invocation} <source WAV> <codec:kbps> [--title <title> --artist <artist> --album <album>] <destination OMA>`);
        return;
    }
    const [source, codec, ...rest] = args;
    let codecSplit = codec.split(':');
    if(codecSplit.length != 2) {
        console.log("Invalid codec format!");
        return;
    }
    let [codecNameStr, codecBitrateStr] = codecSplit;
    let codecBitrate = parseInt(codecBitrateStr);
    if(isNaN(codecBitrate)) {
        console.log("Invalid bitrate provided!");
        return;
    }
    let codecInfo;
    if(codecNameStr == "A3+") {
        codecInfo = generateCodecInfo("A3+", HiMDKBPSToFrameSize.atrac3plus[codecBitrate]);
    } else if(codecNameStr == "AT3") {
        codecInfo = generateCodecInfo("AT3", HiMDKBPSToFrameSize.atrac3[codecBitrate])
    } else {
        console.log("Invalid codec name provided!");
        return;
    }
    let metadata: InboundTrackMetadata = {
        album: "",
        artist: "",
        genre: "",
        title: "",
    };
    let dest = "";
    let i = 0;
    for(i; i < rest.length; i++) {
        let arg = rest[i];
        if(arg == "--title") {
            metadata.title = rest[++i];
        } else if(arg == "--album") {
            metadata.album = rest[++i];
        } else if(arg == "--artist") {
            metadata.artist = rest[++i];
        } else if(arg == "--genre") {
            metadata.genre = rest[++i];
        } else {
            dest = arg;
        }
    }
    if(!fs.existsSync(source)){
        console.log("Source does not exist!");
        return;
    }
    if(fs.existsSync(dest)){
        console.log("Destination file exists!");
        return;
    }
    await initCrypto();
    importKeys(new Uint8Array(fs.readFileSync(join(__dirname, "..", "..", "EKBROOTS.DES"))));

    let rawAudioStream = getAudioDataFromWave(new Uint8Array(fs.readFileSync(source)))!;
    let encrypted = createTaggedEncryptedOMA(rawAudioStream, metadata, codecInfo);
    console.log("MACList value for the encrypted file is: ", Array.from(encrypted.maclistValue).map(e => e.toString(16).padStart(2, '0')).join(''));
    console.log("Duration is: ", encrypted.duration, " seconds");
    fs.writeFileSync(dest, encrypted.data);
}
