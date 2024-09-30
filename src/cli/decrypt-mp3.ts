import fs from 'fs';
import path from 'path';
import { decryptMP3, deriveMP3TrackKey } from '../derive-mp3-key';
import { getMP3EncryptionKey } from '../encryption';

function getIDFromName(name: string) {
    const fileName = path.basename(name).toLowerCase();
    if(fileName.length !== 12 || !fileName.endsWith(".oma") || !fileName.startsWith("10")) {
        throw new Error("Invalid file name!");
    }
    const [ fileBase ] = fileName.split(".", 2);
    const fileId = parseInt(fileBase, 16);
    if(fileId.toString(16) !== fileBase) {
        throw new Error("Cannot parse file name as ID!");
    }
    return fileId - 0x10000000;
}

export function mainDeriveKey(invocation: string, args: string[]) {
    if(args.length < 1) {
        console.log(`Usage: ${invocation} <OMA-encapsulated-MP3>`);
        return;
    }
    const id = getIDFromName(args[0]);
    const source = new Uint8Array(fs.readFileSync(args[0]));
    const PROGRESS_CHARS = ["/", "-", "\\"];
    const trackKey = deriveMP3TrackKey(source, (state, progress, outOf) => {
        if(state !== 'commonness') return;
        process.stdout.write(`\rChecking commonness: ${progress+1}/${outOf} ${PROGRESS_CHARS[progress % PROGRESS_CHARS.length]}`);
    });
    console.log(`\nDerived track key: ${trackKey.toString(16).padStart(8, '0')}`);
    const leafId = getMP3EncryptionKey(trackKey, id);
    console.log(`Device MP3 key: ${leafId.toString(16).padStart(8, '0')}`);
}

export function main(invocation: string, args: string[]) {
    if(args.length < 3) {
        console.log(`Usage: ${invocation} <device key> <OMA-encapsulated-MP3> <output MP3>`);
        return;
    }
    const source = args[1], dest = args[2];
    const deviceKey = parseInt(args[0], 16);
    const fileId = getIDFromName(args[1]);
    if(!fs.existsSync(source)){
        console.log("Source does not exist!");
        return;
    }
    if(fs.existsSync(dest)){
        console.log("Destination file exists!");
        return;
    }
    fs.writeFileSync(dest, decryptMP3(new Uint8Array(fs.readFileSync(source)), fileId, deviceKey));
}
