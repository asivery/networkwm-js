// This file's job is to create the initial structures required to get a brand new (or formatted)
// Sony NW to work.

import { HiMDFilesystem } from "himd-js";
import { InitializationLayer, LAYERS } from "./init-data";

function constructFinalContents(layerNames: (keyof typeof LAYERS)[]) {
    const currentOverlayed: InitializationLayer = { ...LAYERS.root };
    for(const layer of layerNames) {
        for(const [name, value] of Object.entries(LAYERS[layer])) {
            currentOverlayed[name] = value;
        }
    }
    return currentOverlayed;
}

export async function initializeNW(filesystem: HiMDFilesystem, initLayers: (keyof typeof LAYERS)[]){
    // mkdir the root dir
    await filesystem.mkdir("/OMGAUDIO");
    console.log("Initializing the walkman...");
    const initData = constructFinalContents(initLayers);
    for(let [name, contents] of Object.entries(initData)){
        console.log(`Initializing ${name}...`)
        const file = await filesystem.open(`/OMGAUDIO/${name}`, 'rw');
        await file.write(contents);
        await file.close();
    }
    console.log(`Initializing audio store...`)
    await filesystem.mkdir("/OMGAUDIO/10F00");
    const maclist = await filesystem.open("/OMGAUDIO/MACLIST0.DAT", 'rw');
    await maclist.write(new Uint8Array(32768).fill(0));
    await maclist.close();
    console.log(`Initializing complete!`)
}

export async function initializeIfNeeded(filesystem: HiMDFilesystem, initLayers: (keyof typeof LAYERS)[]){
    const rootContents = await filesystem.list("/");
    if(!rootContents.find(e => e.type === 'directory' && e.name === '/OMGAUDIO')){
        // This is an uninitialized NW.
        await initializeNW(filesystem, initLayers);
    }
}

