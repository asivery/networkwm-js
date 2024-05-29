import { CodecInfo, UMSCHiMDFilesystem } from "himd-js";
import { FatFilesystem } from "nufatfs";
import { WebUSBDevice } from "usb";
import { DatabaseManager } from "./databases";
import { SonyVendorNWJSUSMCDriver, UMSCNWJSFilesystem, UMSCNWJSSession } from "./filesystem";
import { createTaggedEncryptedOMA } from "./tagged-oma";
import { concatUint8Arrays, join } from "./utils";

export async function uploadTrack(
    database: DatabaseManager,
    session: UMSCNWJSSession,
    trackInfo: {artist: string, album: string, title: string, genre: string},
    codec: CodecInfo,
    rawData: Uint8Array
) {
    // Step 1 - Create the encrypted OMA which will later be written to the device's storage
    const encryptedOMA = createTaggedEncryptedOMA(rawData, trackInfo, codec);
    
    // Step 2 - write track to the database
    const globalTrackIndex = database.addNewTrack(trackInfo, encryptedOMA.key, codec);

    // Step 3 - write track to the filesystem
    const fh = await database.himdFilesystem.open(join('OMGAUDIO', '10F00', '1000' + globalTrackIndex.toString(16).padStart(4, '0') + '.OMA'), 'rw');
    await fh.write(encryptedOMA.data);
    await fh.close();

    // Step 4 - write MAC
    session.writeTrackMac(globalTrackIndex - 1, encryptedOMA.maclistValue);
}

export async function createNWJSFS(webUsbDevice: WebUSBDevice, bypassCoherencyChecks: boolean){
    // Connect into the HiMD codebase
    const fs = new UMSCNWJSFilesystem(webUsbDevice);

    await fs.init();
    return fs;
}