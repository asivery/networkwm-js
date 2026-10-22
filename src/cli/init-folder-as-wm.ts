import { DatabaseAbstraction } from '../database-abstraction';
import { importKeys, initCrypto } from '../encryption';
import { UMSCNWJSSession } from '../filesystem';
import { createNWJSFS, openNewDeviceNode } from '../node-helpers';
import { join } from 'path';
import nfs from 'fs';
import { DeviceIds } from '../devices';
import { initializeNW } from '../initialization';
import { NativeHiMDFilesystem } from 'himd-js';

export async function main(invocation: string, args: string[]) {
    let partialName = args[0];
    let folder = args[1];
    if (!partialName || !folder || nfs.existsSync(folder)) {
        console.log(`Usage: ${invocation} <partial walkman name> <folder to init>`);
        return;
    }

    const walkmansMatching = DeviceIds.filter((e) => e.name.includes(partialName));
    if (walkmansMatching.length > 1) {
        console.log('Error: More than one matching walkman!');
        return;
    } else if (walkmansMatching.length === 0) {
        console.log('Error: No walkman found!');
        return;
    }

    const walkmanMatching = walkmansMatching[0];

    initializeNW(new NativeHiMDFilesystem(folder), walkmanMatching.databaseParameters?.initLayers ?? []);
}
