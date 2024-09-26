import { WebUSBDevice, findByIds, usb } from "usb";
import { UMSCNWJSFilesystem } from "./filesystem";
import { join } from "./utils";
import { DeviceDefinition, DeviceIds } from "./devices";
import { initializeIfNeeded } from "./initialization";

export function resolvePathFromGlobalIndex(globalTrackIndex: number){
    return join('OMGAUDIO', '10F00', '1000' + globalTrackIndex.toString(16).padStart(4, '0').toUpperCase() + '.OMA');
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
