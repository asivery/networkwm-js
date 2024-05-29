# Work In Progress!!

## JS library for accessing Sony Network Walkmen

This library aims to provide support for managing audio content on Sony Network Walkman devices.
It supports the same functionality as SonicStage - the original Sony application required to communicate with them.

For now, it is impossible to use this library as a standalone application - there's no CLI available.

## What features are available?

- [x] Track upload (ATRAC3 / ATRAC3+)
- [x] DRM reimplementation
- [ ] Fetching contents' list
- [ ] Track upload (MP3)
- [ ] Track metadata editing (Title / Album / Artist / Genre)
- [ ] Track moving
- [ ] Track deletion
- [ ] OMA file decryption

## How to incorporate it into your project?

The library piggybacks on [himd-js](https://github.com/asivery/himd-js) to provide low-level filesystem and SCSI functionality.
Because of how the DRM requires vendor SCSI commands to be sent to the Network Walkman, it is impossible to upload a track and have it play on the device without SCSI access, but similarly to himd-js, it provides a way to edit the player's metadata.

### 1 - Metadata access only

In this mode, it's only possible to read and write tracks' metadata (titles, track play order, etc.)

**It is not possible to upload ATRAC3/3+/PCM with this mode.**

Example:
```ts
async function example(){
    // When using Node.JS:
    const fs = new NativeHiMDFilesystem("/path/to/HiMD/root");

    const db = new DatabaseManager(fs);
    await db.init();
}
```

### 2 - Direct mode (USB Mass Storage Controller mode)

Because this mode takes full control over the Network Walkman, and can issue direct SCSI commands, it's possible to upload ATRAC3/3+ audio.

All the examples from mode 1 which utilize the `DatabaseManager` object still work.

Example:
```ts
async function example(){
    await initCrypto();
    importKeys(...);
    let legacyDevice = findByIds(0x054c, 0x01ad)!;
    
    if(!legacyDevice) {
        console.log("No such device!");
        return false;
    }

    legacyDevice.open();
    await new Promise(res => legacyDevice.reset(res));
    const iface = legacyDevice.interface(0);
    try{
        if(iface.isKernelDriverActive())
            iface.detachKernelDriver();
    }catch(ex){
        console.log("Couldn't detach the kernel driver. Expected on Windows.");
    }
    const webUsbDevice = (await WebUSBDevice.createInstance(legacyDevice))!;
    await webUsbDevice.open();

    const fs = await createNWJSFS(webUsbDevice, false);
    // Open a writing session
    const session = new UMSCNWJSSession(fs.driver as SonyVendorNWJSUSMCDriver, fs);
    await session.performAuthorization();

    const database = new DatabaseManager(fs);
    await database.init();

    // Read the track
    const trackContents = new Uint8Array(nodeFs.readFileSync("/path/to/raw/atrac.wav")).slice(0x60);
    const codec = generateCodecInfo("A3+", HiMDKBPSToFrameSize.atrac3plus[352]);
    await uploadTrack(database, session, {
        album: "Foobar - The Greatest Hits",
        artist: "Foobaz",
        genre: "Bar",
        title: "Foobar",
    }, codec, trackContents);

    database.reserializeTables();
    await database.rewriteTables();
    await session.finalizeSession();
}
```

It is also possible to use this library to simply sign the device, so that it plays audio which could have been copied across from a different Network Walkman. To do that, it's simply enough to perform the authorization, and then finalize the session straightaway.

```typescript
async function example(){
    await initCrypto();
    importKeys(...);
    let legacyDevice = findByIds(0x054c, 0x01ad)!;

    await new Promise(res => legacyDevice.reset(res));
    const iface = legacyDevice.interface(0);
    try{
        if(iface.isKernelDriverActive())
            iface.detachKernelDriver();
    }catch(ex){
        console.log("Couldn't detach the kernel driver. Expected on Windows.");
    }
    const webUsbDevice = (await WebUSBDevice.createInstance(legacyDevice))!;
    await webUsbDevice.open();

    const fs = await createNWJSFS(webUsbDevice, false);

    // Start a new session...
    const session = new UMSCNWJSSession(fs.driver as SonyVendorNWJSUSMCDriver, fs);
    await session.performAuthorization();
    // ...and terminate it
    await session.finalizeSession();
    // At this point, the Walkman should play the audio.
}
```

### Credits
- Thank you to M Karcher over at the MiniDisc.wiki Discord server for explaining how the OpenMG keys deriving and SCSI authentication works
- The [rustystage](https://github.com/antoyo/rustystage) project provided excellent documentation of the database format.
