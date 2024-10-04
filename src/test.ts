import nfs from 'fs';
import { parse } from './id3';

import { createNWJSFS, openNewDeviceNode } from './helpers';
import { DatabaseAbstraction } from './database-abstraction';
import { UMSCNWJSSession } from './filesystem';
import { generateCodecInfo, HiMDKBPSToFrameSize } from 'himd-js';
import { importKeys, initCrypto } from './encryption';
import { NWCodec, NWCodecInfo, getKBPS } from './codecs';
// (async () => {
//     const data = new Uint8Array(fs.readFileSync("/ram/10000001.OMA"));
//     const id3 = parse(data);
//     console.log(id3);
//     for(let tag of id3.tags) {
//         fs.writeFileSync(`/ram/tag-${tag.id}`, tag.contents);
//     }
// })();
// import {  } from 'himd-js';
// import { createEA3Header } from './utils';
// (async () => {
//     const header = createEA3Header({  })
// })

// const data = new Uint8Array(fs.readFileSync("/ram/10000007.OMA"));
// let trackKey;
// console.log(trackKey = deriveMP3TrackKey(data, console.log));
// console.log(deriveDeviceKey(trackKey, 0x07));

(async () => {
    // const device = await openNewDeviceNode();
    // initCrypto();
    // importKeys(new Uint8Array(nfs.readFileSync("EKBROOTS.DES")));
    // if(!device) {
    //     console.log("No device");
    //     return;
    // }
    // console.log(`Connected to ${device.definition.name}`);
    // const fs = await createNWJSFS(device);
    // const database = await DatabaseAbstraction.create(fs, device.definition);

    // const session = new UMSCNWJSSession(fs.driver, fs);
    // await session.performAuthorization();

    // const trackNames = (JSON.parse(nfs.readFileSync("/mnt/NAS/Code/ALT_SS_STAGE/Putting the 9 hour mix on the MD/titlesv2/tracknames.json").toString()) as [string, string][]).map(e => e[1]);

    // const BASE_LOC = "/mnt/NAS/Code/ALT_SS_STAGE/Putting the 9 hour mix on the MD/tracks/";
    // for(let i = 1; i<180; i++){
    //     let file = `${BASE_LOC}/${i + 1}.wav`;
    //     const contents = new Uint8Array(nfs.readFileSync(file)).subarray(76);
    //     await uploadTrack(database, session, {
    //         album: "The Ultimate S3RL Tribute Mix 2023",
    //         artist: "S3RL",
    //         genre: "Happy Hardcore",
    //         title: trackNames[i],
    //         trackDuration: -1,
    //         trackNumber: -1,
    //     }, generateCodecInfo("AT3", HiMDKBPSToFrameSize.atrac3[66]), contents, console.log);
    //     console.log(`Finished uploading ${i + 1} / 180`);
    // }
    // await session.finalizeSession();
    // await database.flushUpdates();
    // await fs.fatfs!.flushMetadataChanges();
    // console.log(await fs.list("/OMGAUDIO"));
    // const session = new UMSCNWJSSession(fs.driver, fs);
    // await session.performAuthorization();
    // await database.uploadTrack({
    //     album: 'Singles',
    //     artist: 'cy4ne',
    //     genre: 'Scenecore',
    //     title: 'solace',
    //     trackNumber: -1,
    // }, generateCodecInfo('A3+', HiMDKBPSToFrameSize.atrac3plus[256]), new Uint8Array(nfs.readFileSync("/ram/solace.raw.at3p")), session);
    // await session.finalizeSession();
    // await database.flushUpdates();
    // await fs.fatfs!.flushMetadataChanges();

    const nwCodec: NWCodecInfo = {
        codecId: NWCodec.MP3,
        codecInfo: new Uint8Array([0x80, 0xdd, 0x10]),
    };
    console.log(getKBPS(nwCodec));

})().then( () => process.exit(0));

