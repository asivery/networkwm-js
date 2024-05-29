import { CodecInfo, UMSCHiMDFilesystem } from "himd-js";
import { FatFilesystem } from "nufatfs";
import { WebUSBDevice } from "usb";
import { DatabaseManager } from "./databases";
import { SonyVendorNWJSUSMCDriver, UMSCNWJSSession } from "./filesystem";
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
    const fs = new UMSCHiMDFilesystem(webUsbDevice);
    fs.driver = new SonyVendorNWJSUSMCDriver(webUsbDevice, 0x06);
    // HACK: This should be incorporated into himd-js by making it more generic.
    (fs as any).initFS = async function(){
        await this.driver.inquiry();
        await this.driver.testUnitReady();
        const partInfo = await this.driver.getCapacity();
        console.log(partInfo);
        this.fsUncachedDriver = await this.driver.createNUFatFSVolumeDriverFromMBRPart(0, true);

        this.fsDriver = {...this.fsUncachedDriver,
            readSectors: async (i: number, count: number) => {
                let outputBuffers: Uint8Array[] = [];
                while(count > 0){
                    let toRead = Math.min(count, 100);
                    outputBuffers.push(await this.fsUncachedDriver!.readSectors(i, toRead));
                    i += toRead;
                    count -= toRead;
                }
                return concatUint8Arrays(outputBuffers);
            },
            writeSectors: async (i: number, data: Uint8Array) => {
                let offset = 0;
                while(offset < data.length) {
                    let toWrite = data.subarray(offset, Math.min(data.length, offset + partInfo.blockSize * 10));
                    await this.fsUncachedDriver!.writeSectors(i, toWrite);
                    offset += toWrite.length;
                    i += toWrite.length / partInfo.blockSize;
                }
            }
        };

        this.fatfs = await FatFilesystem.create(this.fsDriver, bypassCoherencyChecks);
        this.volumeSize = partInfo.deviceSize;
        this.lowSectorsCache = () => Array(1000)
            .fill(0)
            .map(() => ({ dirty: false, data: null }));
    }

    await fs.init();
    return fs;
}