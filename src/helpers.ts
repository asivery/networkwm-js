import { WebUSBDevice, findByIds, usb } from "usb";
import { UMSCNWJSFilesystem } from "./filesystem";
import { join } from "./utils";
import { DeviceIds } from "./devices";
import { initializeIfNeeded } from "./initialization";

export function resolvePathFromGlobalIndex(globalTrackIndex: number){
    return join('OMGAUDIO', '10F00', '1000' + globalTrackIndex.toString(16).padStart(4, '0').toUpperCase() + '.OMA');
}

export async function createNWJSFS(webUsbDevice: WebUSBDevice, bypassCoherencyChecks: boolean){
    // Connect into the HiMD codebase
    const fs = new UMSCNWJSFilesystem(webUsbDevice);

    await fs.init();
    await initializeIfNeeded(fs);
    return fs;
}

export async function openNewDeviceNode(): Promise<{ dev: WebUSBDevice, name: string } | null> {
    let legacyDevice: usb.Device | undefined = undefined, devName: string | null = null;
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
