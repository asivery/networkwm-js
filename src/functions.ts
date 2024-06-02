import { CodecInfo } from "himd-js";
import { WebUSBDevice, findByIds } from "usb";
import { DatabaseManager } from "./databases";
import { UMSCNWJSFilesystem, UMSCNWJSSession } from "./filesystem";
import { createTaggedEncryptedOMA } from "./tagged-oma";
import { join } from "./utils";
import { DeviceIds } from "./devices";

export async function uploadTrack(
    database: DatabaseManager,
    session: UMSCNWJSSession,
    trackInfo: {artist: string, album: string, title: string, genre: string},
    codec: CodecInfo,
    rawData: Uint8Array,
    callback?: (done: number, outOf: number) => void
) {
    // Step 1 - Create the encrypted OMA which will later be written to the device's storage
    const encryptedOMA = createTaggedEncryptedOMA(rawData, trackInfo, codec);
    
    // Step 2 - write track to the database
    const globalTrackIndex = database.addNewTrack(trackInfo, encryptedOMA.key, codec);

    // Step 3 - write track to the filesystem
    const fh = await database.filesystem.open(join('OMGAUDIO', '10F00', '1000' + globalTrackIndex.toString(16).padStart(4, '0').toUpperCase() + '.OMA'), 'rw');
    const data = encryptedOMA.data;
    let remaining = data.length;
    let i = 0;
    callback?.(i, data.length);
    while(remaining) {
        const toWrite = Math.min(2048, remaining);
        await fh.write(data.slice(i, i + toWrite));
        i += toWrite;
        remaining -= toWrite;
        callback?.(i, data.length);
    }
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

export async function openNewDeviceNode(): Promise<{ dev: WebUSBDevice, name: string } | null> {
    let legacyDevice: any, devName: string | null = null;
    for(let dev of DeviceIds){
        legacyDevice = findByIds(dev.vendorId, dev.productId)!;
        if(legacyDevice) {
            devName = dev.name;
            break;
        }
    }
    
    if(!legacyDevice) {
        return null;
    }

    legacyDevice.open();
    await new Promise(res => legacyDevice.reset(res));
    const iface = legacyDevice.interface(0);
    try{
        if(iface.isKernelDriverActive())
            iface.detachKernelDriver();
    }catch(ex){
        // console.log("Couldn't detach the kernel driver. Expected on Windows.");
    }
    const webUsbDevice = (await WebUSBDevice.createInstance(legacyDevice))!;
    await webUsbDevice.open();

    return { dev: webUsbDevice, name: devName! };
}
