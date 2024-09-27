# Work In Progress!!

## JS library for accessing Sony Network Walkmen

This library aims to provide support for managing audio content on Sony Network Walkman devices.
It supports the same functionality as SonicStage - the original Sony application required to communicate with them.

For now, it is impossible to use this library as a standalone application - there's no CLI available.

## What features are available?

- [x] Track upload (ATRAC3 / ATRAC3+)
- [x] DRM reimplementation
- [X] Fetching contents' list
- [X] Track upload (MP3)
- [X] Track metadata editing (Title / Album / Artist / Genre)
- [X] Track moving
- [X] Track deletion
- [X] OMA file decryption
- [X] MP3 device leaf ID derivation

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

    const database = await DatabaseAbstraction.create(fs);
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
    const _dev = await openNewDeviceNode();
    if(!_dev) {
        console.log("Could not connect!");
        return;
    }
    const { dev, name } = _dev;
    console.log(`Connected to ${name}`);
    const fs = await createNWJSFS(dev, false);
    // Open a writing session
    const session = new UMSCNWJSSession(fs.driver as SonyVendorNWJSUSMCDriver, fs);
    await session.performAuthorization();

    const database = await DatabaseAbstraction.create(fs);

    // Read the track
    const trackContents = new Uint8Array(nodeFs.readFileSync("/path/to/raw/atrac.wav")).slice(0x60);
    const codec = generateCodecInfo("A3+", HiMDKBPSToFrameSize.atrac3plus[352]);
    database.uploadTrack({
        album: "Foobar - The Greatest Hits",
        artist: "Foobaz",
        genre: "Bar",
        title: "Foobar",
        trackDuration: -1,
        trackNumber: -1, // Guess the track number
    }, codec, trackContents, session);

    await database.flushUpdates();
    await session.finalizeSession();
}
```

It is also possible to use this library to simply sign the device, so that it plays audio which could have been copied across from a different Network Walkman. To do that, it's simply enough to perform the authorization, and then finalize the session straightaway.

```typescript
async function example(){
    await initCrypto();
    importKeys(...);
    const _dev = await openNewDeviceNode();
    if(!_dev) {
        console.log("Could not connect!");
        return;
    }
    const { dev, name } = _dev;
    console.log(`Connected to ${name}`);
    const fs = await createNWJSFS(dev, false);

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
