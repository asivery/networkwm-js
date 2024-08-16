import { HiMDFile, HiMDFilesystem, SonyVendorUSMCDriver, UMSCHiMDFilesystem } from 'himd-js';
import { assert, concatUint8Arrays, createRandomBytes } from '../utils';
import { getUint32, writeUint16, writeUint32 } from '../bytemanip';
import { createIcvMac, desDecrypt, EKBROOTS, retailMac } from '../encryption';
import { WebUSBDevice } from 'usb';
import { createChunkingDriver, FatFilesystem } from 'nufatfs';

export class SonyVendorNWJSUSMCDriver extends SonyVendorUSMCDriver {
    protected async drmRead(param: number, length: number) {
        const command = new Uint8Array([
            0xa4,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0xbc,
            (length >> 8) & 0xff,
            length & 0xff,
            param,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
        ]);
        const result = await this.sendCommandInGetResult(command, length, false, command.length);
        return result.result.subarray(2);
    }

    protected async drmWrite(param: number, data: Uint8Array) {
        const newData = new Uint8Array(data.length + 2);
        newData.set(writeUint16(data.length), 0);
        newData.set(data, 2);
        const length = newData.length;

        const command = new Uint8Array([
            0xa3,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0xbc,
            (length >> 8) & 0xff,
            length & 0xff,
            param,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
        ]);
        await this.sendCommandOutGetResult(command, newData, command.length);
    }

    async writeHostLeafID(leafID: Uint8Array, hostNonce: Uint8Array) {
        assert(leafID.length === 8, 'Wrong length of leaf id');
        const finalBuffer = new Uint8Array(2 + 8 + 8);
        finalBuffer.fill(0);
        finalBuffer.set(leafID, 2);
        finalBuffer.set(hostNonce, 10);
        await this.drmWrite(0x30, finalBuffer);
    }

    async getAuthenticationStage2Info() {
        const data = await this.drmRead(0x31, 0x43c);

        let _current = 2;
        const read = (len: number) => data.subarray(_current, (_current += len));
        const discId = read(16);
        const mac = read(8);
        const deviceLeafId = read(8);
        const deviceNonce = read(8);

        // // EKB info begin
        // const keyType = read(4);
        // const keyLevel = read(4);
        // const ekbid = read(4);
        // const zero = read(4);
        // const key = read(16);

        return { discId, mac, deviceLeafId, deviceNonce };
    }

    async writeAuthenticationStage3Info(hostMac: Uint8Array) {
        const finalBuffer = new Uint8Array(0x41a);
        finalBuffer.fill(0);
        finalBuffer.set(hostMac, 2);
        // Send own configuration
        // Key type 1
        // Key level 8
        // EKB 00010021
        // Encrypted Node Key: 0xf0, 0x5c, 0xb7, 0xfe, 0xde, 0x3c, 0x94, 0x01, 0x78, 0x4a, 0x71, 0x8d, 0x9f, 0xf7, 0xf4, 0xb1
        finalBuffer.set(
            [
                0x00, 0x00, 0x00, 0x01,
                0x00, 0x00, 0x00, 0x08,
                0x00, 0x01, 0x00, 0x21,
                
                0x00, 0x00, 0x00, 0x00,

                0xf0, 0x5c, 0xb7, 0xfe, 0xde, 0x3c, 0x94, 0x01,
                0x78, 0x4a, 0x71, 0x8d, 0x9f, 0xf7, 0xf4, 0xb1,
            ],
            10
        );
        await this.drmWrite(0x32, finalBuffer);
    }

    async readMasterKey() {
        const data = await this.drmRead(0x33, 0x404);
        let _current = 2;
        const read = (len: number) => data.subarray(_current, (_current += len));
        const header = read(8);
        // Zeros
        _current += 4;
        const masterKey = read(16);
        return { header, masterKey };
    }

    async writeMasterKeyAndMac(generation: number, masterKey: Uint8Array, mac: Uint8Array, sessionKey: Uint8Array){
        // masterKey = 0xe0, 0xaa, 0x0b, 0x24, 0xd5, 0x1f, 0x97, 0x1d, 0x57, 0xaa, 0x7a, 0x3f, 0x8f, 0x93, 0xe7, 0xb3
        // mac = 0x9e, 0x29, 0xe4, 0xa3, 0x4f, 0x8d, 0x43, 0xc7

        const generationBytes = writeUint32(generation);
        const theSonySoup = new Uint8Array([
            0x00, 0x20, 0x00, 0x98, // Rewrite
            ...generationBytes, // Generation data
            0x00, 0x00, 0x00, 0x00, // ???
            0x00, 0x01, 0x00, 0x21, // Authenticate using ekb 00010021
            ...masterKey, // The key
            ...mac, // MAC over the MACLIST, bound to device
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ]);
        theSonySoup.set(writeUint32(generation), 4);

        const newMac = createIcvMac(theSonySoup, sessionKey);
        const finalBuffer = new Uint8Array(0x402).fill(0);
        finalBuffer.set(newMac, 2 + theSonySoup.length);
        finalBuffer.set(theSonySoup, 2);
            
        await this.drmWrite(0x34, finalBuffer);
    }
}

export class UMSCNWJSSession {
    hostNonce = createRandomBytes();
    hostLeafId = new Uint8Array([0x03, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

    deviceNonce?: Uint8Array;
    discId?: Uint8Array;
    deviceLeafId?: Uint8Array;
    currentIcv?: Uint8Array;
    currentIcvHeader?: Uint8Array;
    sessionKey?: Uint8Array;

    mclistHandle?: HiMDFile;
    currentGeneration?: number;

    allMacs?: Uint8Array;

    constructor(protected driver: SonyVendorNWJSUSMCDriver, protected fs: HiMDFilesystem) {}

    public async performAuthorization(){
        await this.driver.writeHostLeafID(this.hostLeafId, this.hostNonce);
        const resultsStage2 = await this.driver.getAuthenticationStage2Info();
        this.discId = resultsStage2.discId;
        this.deviceLeafId = resultsStage2.deviceLeafId;
        this.deviceNonce = resultsStage2.deviceNonce;
        // Disregard device mac
        const ekb10021Root = EKBROOTS[0x00010021];
        const hostMac = retailMac(concatUint8Arrays([resultsStage2.discId, resultsStage2.deviceNonce, this.hostNonce]), ekb10021Root);
        await this.driver.writeAuthenticationStage3Info(hostMac);
        const { header, masterKey: anyKey } = await this.driver.readMasterKey();
        this.sessionKey = retailMac(concatUint8Arrays([resultsStage2.discId, resultsStage2.mac, hostMac]), ekb10021Root);
        this.currentGeneration = getUint32(header, 4);

        this.mclistHandle = await this.fs.open("/OMGAUDIO/MACLIST0.DAT", "rw");
        this.allMacs = await this.mclistHandle.read();
    }

    public async finalizeSession() {
        const ekb10021Root = EKBROOTS[0x00010021];
        this.currentGeneration! += 1;
        const masterKey = new TextEncoder().encode('.DRMisBadForYou.');
        const mac = retailMac(concatUint8Arrays([this.discId!, this.allMacs!]), desDecrypt(masterKey, ekb10021Root));
        await this.driver.writeMasterKeyAndMac(this.currentGeneration!, masterKey, mac, this.sessionKey!);
        await this.mclistHandle!.seek(0);
        await this.mclistHandle!.write(this.allMacs!);
        await this.mclistHandle!.close();
    }

    // trackNumber starts from 0
    public writeTrackMac(trackNumber: number, mac: Uint8Array){
        this.allMacs!.set(mac, trackNumber * 8);
    }
}

export class UMSCNWJSFilesystem extends UMSCHiMDFilesystem {
    driver: SonyVendorNWJSUSMCDriver;
    constructor(webUSB: WebUSBDevice){
        super(webUSB);
        this.driver = new SonyVendorNWJSUSMCDriver(webUSB, 0x06);
    }

    protected async initFS(bypassCoherencyChecks?: boolean | undefined): Promise<void> {
        await this.driver.inquiry();
        await this.driver.testUnitReady();
        const partInfo = await this.driver.getCapacity();
        console.log(partInfo);

        const baseDriver = await this.driver.createNUFatFSVolumeDriverFromMBRPart(0, true);
        this.fsUncachedDriver = this.fsDriver = createChunkingDriver(baseDriver, 240, partInfo.blockSize);

        this.fatfs = await FatFilesystem.create(this.fsDriver, bypassCoherencyChecks);
        this.volumeSize = partInfo.deviceSize;
    }
}
