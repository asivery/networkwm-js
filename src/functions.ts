import { CodecInfo } from "himd-js";
import { WebUSBDevice, findByIds } from "usb";
import { TrackMetadata } from "./databases";
import { UMSCNWJSFilesystem, UMSCNWJSSession } from "./filesystem";
import { createTaggedEncryptedOMA } from "./tagged-oma";
import { join } from "./utils";
import { DeviceDefinition, DeviceIds } from "./devices";
import { DatabaseAbstraction } from "./database-abstraction";
import { initializeIfNeeded } from "./initialization";

function resolvePathFromGlobalIndex(globalTrackIndex: number){
    return join('OMGAUDIO', '10F00', '1000' + globalTrackIndex.toString(16).padStart(4, '0').toUpperCase() + '.OMA');
}

export async function uploadTrack(
    database: DatabaseAbstraction,
    session: UMSCNWJSSession,
    trackInfo: TrackMetadata,
    codec: CodecInfo,
    rawData: Uint8Array,
    callback?: (done: number, outOf: number) => void
) {
    // Step 1 - Create the encrypted OMA which will later be written to the device's storage
    const encryptedOMA = createTaggedEncryptedOMA(rawData, trackInfo, codec);
    // Step 2 - write track to the database
    const globalTrackIndex = database.addNewTrack({
        ...trackInfo,
        trackDuration: encryptedOMA.duration,
    }, codec);

    // Step 3 - write track to the filesystem
    const fh = await database.database.filesystem.open(resolvePathFromGlobalIndex(globalTrackIndex), 'rw');
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

export async function createNWJSFS(device: { dev: WebUSBDevice, definition: DeviceDefinition }){
    // Connect into the HiMD codebase
    const fs = new UMSCNWJSFilesystem(device.dev);

    await fs.init();
    await initializeIfNeeded(fs, device.definition.databaseParameters?.initLayers ?? []);
    return fs;
}

export async function openNewDeviceNode(): Promise<{ dev: WebUSBDevice, definition: DeviceDefinition } | null> {
    let legacyDevice: any, definition: DeviceDefinition | null = null;
    for(let dev of DeviceIds){
        legacyDevice = findByIds(dev.vendorId, dev.productId)!;
        if(legacyDevice) {
            definition = dev;
            break;
        }
    }
    
    if(!legacyDevice || !definition) {
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

    return { dev: webUsbDevice, definition };
}
