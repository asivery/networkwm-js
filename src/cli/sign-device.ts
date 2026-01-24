import { DatabaseAbstraction } from "../database-abstraction";
import { importKeys, initCrypto } from "../encryption";
import { UMSCNWJSSession } from "../filesystem";
import { createNWJSFS, openNewDeviceNode } from "../node-helpers";
import { join } from 'path';
import nfs from 'fs';

export async function main() {
    await initCrypto();
    importKeys(new Uint8Array(nfs.readFileSync(join(__dirname, "..", "..", "EKBROOTS.DES"))));
    const device = await openNewDeviceNode();
    if(!device){
        console.log("No device found!");
        return;
    }
    const fs = await createNWJSFS(device);
    console.log(`Connected to ${device.definition.name}`);
    console.log("Opening session...");
    const session = new UMSCNWJSSession(fs.driver, fs);
    console.log("Authorizing...");
    await session.performAuthorization();
    console.log("Signing...");
    await session.finalizeSession();
    console.log("Done.");
}