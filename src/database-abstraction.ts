import { CodecInfo, HiMDCodecName, HiMDFilesystem, getCodecName, getKBPS } from "himd-js";
import { DatabaseManager, GroupEntry, TrackMetadata, TreeFile } from "./databases";
import { complexSort, ComplexSortFormatPart, flatten } from "./sort";
import { initializeNW } from "./initialization";
import { UMSCNWJSFilesystem, UMSCNWJSSession } from "./filesystem";
import { createTaggedEncryptedOMA, updateMetadata } from "./tagged-oma";
import { resolvePathFromGlobalIndex } from "./helpers";
import { DeviceDefinition } from "./devices";

export type AbstractedTrack = TrackMetadata & {
    encryptionState: Uint8Array,
    codecInfo: Uint8Array,
    oneElementLength: number,
    systemIndex: number,

    codecName: HiMDCodecName,
    codecKBPS: number,
};

export class DatabaseAbstraction {
    private content1ArtistAlbumTrack?: ContentDescriptionPair;
    private lastTotalDuration: number = 0;
    private allTracks: AbstractedTrack[] = [];
    private deletedTracks: number[] = [];
    public database: DatabaseManager;
    private constructor(private filesystem: HiMDFilesystem, public deviceInfo: DeviceDefinition) {
        this.database = new DatabaseManager(filesystem);
    }

    public static async create(filesystem: HiMDFilesystem, deviceInfo: DeviceDefinition) {
        const db = new DatabaseAbstraction(filesystem, deviceInfo);
        await db.database.init();
        db._create();
        return db;
    }

    private _create() {
        // Parse the group info file.
        this.lastTotalDuration = 0;
        this.content1ArtistAlbumTrack = contentDescriptionPairFromFiles(
            this.database.parsedTreeFiles["01TREE03.DAT"],
            this.database.parsedGroupInfoFiles["03GINF03.DAT"],
        );
        this.deletedTracks = [];
        this.allTracks = this.database.globalContentInfoFile.map((globalEntry, systemIndex) => {
            // Locate the track index
            const trackIndex = this.content1ArtistAlbumTrack!.find(e => e.tracks.includes(systemIndex + 1))?.tracks.indexOf(systemIndex + 1) ?? 1;
            this.lastTotalDuration += globalEntry.trackDuration;
            const codecId = globalEntry.codecInfo[0];
            const codecParams = globalEntry.codecInfo.slice(1);
            const codecInfo = { codecId, codecInfo: codecParams };
            const codecName = getCodecName(codecInfo);
            const codecKBPS = getKBPS(codecInfo);
            if(globalEntry.trackDuration === 0) this.deletedTracks.push(systemIndex + 1);
            return {
                album: globalEntry.contents["TALB"],
                artist: globalEntry.contents["TPE1"],
                codecInfo: globalEntry.codecInfo,
                encryptionState: globalEntry.encryptionState,
                genre: globalEntry.contents["TCON"],
                oneElementLength: globalEntry.oneElementLength,
                title: globalEntry.contents["TIT2"],
                trackDuration: globalEntry.trackDuration,
                trackNumber: trackIndex,
                systemIndex: systemIndex + 1,
                codecName, codecKBPS
            };
        });
    }

    public addNewTrack(trackInfo: TrackMetadata, codecInfo: CodecInfo) {
        const codecName = getCodecName(codecInfo);
        const codecKBPS = getKBPS(codecInfo);

        const newObject: AbstractedTrack = {
            ...trackInfo,
            codecInfo: new Uint8Array([codecInfo.codecId, ...codecInfo.codecInfo.subarray(0, 3)]),
            encryptionState: new Uint8Array([0, 1]),
            oneElementLength: 128,
            systemIndex: -1,
            codecName, codecKBPS
        };
        // Do we have any free gaps after deleted tracks?
        if(this.deletedTracks.length > 0) {
            // Reuse it instead.
            const reusedIndex = this.deletedTracks.splice(0, 1)[0];
            this.allTracks.splice(reusedIndex - 1, 1, newObject);
            newObject.systemIndex = reusedIndex;
            return reusedIndex;
        }
        const idx = this.allTracks.push(newObject);
        newObject.systemIndex = idx;
        return newObject.systemIndex;
    }

    async uploadTrack(
        trackInfo: TrackMetadata,
        codec: CodecInfo,
        rawData: Uint8Array,
        session?: UMSCNWJSSession,
        callback?: (done: number, outOf: number) => void
    ) {
        // If trackInfo.trackNumber == -1, it's the next one of this particular album
        if(trackInfo.trackNumber == -1) {
            trackInfo.trackNumber = this.allTracks
                .filter(e => e.album === trackInfo.album && e.artist === trackInfo.artist)
                .reduce((prev, c) => Math.max(prev, c.trackNumber), -1) + 1;
        }
        // Step 1 - Create the encrypted OMA which will later be written to the device's storage
        const encryptedOMA = createTaggedEncryptedOMA(rawData, trackInfo, codec);
        // Step 2 - write track to the database
        const globalTrackIndex = this.addNewTrack({
            ...trackInfo,
            trackDuration: encryptedOMA.duration,
        }, codec);
    
        // Step 3 - write track to the filesystem
        const fh = await this.database.filesystem.open(resolvePathFromGlobalIndex(globalTrackIndex), 'rw');
        const data = encryptedOMA.data;
        let remaining = data.length;
        let i = 0;
        callback?.(i, data.length);
        while(remaining) {
            const toWrite = Math.min(2048, remaining);
            await fh.write(data.slice(i, i + toWrite));
            i += toWrite;
            remaining -= toWrite;
            callback?.(i, data.length);
        }
        await fh.close();

        // Step 4 - write MAC
        session?.writeTrackMac(globalTrackIndex - 1, encryptedOMA.maclistValue);
    }

    async flushUpdates() {
        this.reserializeDatabase();
        this.database.reserializeTables();
        return this.database.rewriteTables();
    }

    async deleteTrack(systemIndex: number) {
        const track = this.allTracks[systemIndex - 1];
        // Wipe metadata information.
        track.trackDuration = 0;
        track.album = "";
        track.artist = "";
        track.title = "";
        this.deletedTracks.push(systemIndex);
        // Sort
        this.deletedTracks.sort((a, b) => a - b);
        // Delete the file.
        await this.filesystem.delete(resolvePathFromGlobalIndex(systemIndex));
    }

    reserializeDatabase() {
        // TREE01 - {album} - {trackNumber}
        type ReserializationInstruction = {
            metadataCreator: (track: AbstractedTrack) => {[key: string]: string},
            sorting: ComplexSortFormatPart[][]
        };

        const instrs: ReserializationInstruction[] = [
            // TREE01 - Groups (I use [aritst - album] > [trackNumber])
            {
                metadataCreator: e => ({
                    TIT2: e.album,
                    TPE1: e.artist,
                    TCON: '',
                    TSOP: '',
                    PICP: '',
                    PIC0: '',
                }),
                sorting: [[{ var: 'artist' }, { literal: '-----'}, { var: 'album' }], [{ var: 'trackNumber'}]],
            },
            // TREE02 - [artist] > [title]
            {
                metadataCreator: e => ({ TIT2: e.artist }),
                sorting: [[{ var: 'artist' }], [{ var: 'title'}]],
            },
            // TREE03 - [album] > [trackNumber]
            {
                metadataCreator: e => ({ TIT2: e.album }),
                sorting: [[{ var: 'album' }], [{ var: 'trackNumber' }]],
            },
            // TREE04 - [genre] > [title]
            // ...who came up with this order??
            {
                metadataCreator: e => ({ TIT2: e.genre }),
                sorting: [[{ var: 'genre' }], [{ var: 'title' }]],
            },
        ];

        for(let fileIndex = 0; fileIndex < instrs.length; fileIndex++) {
            const sortingInstr = instrs[fileIndex];
            const sorted = complexSort(sortingInstr.sorting, this.allTracks.filter(e => e.trackDuration > 0));
            const entries: ContentDescriptionPair = [];
            for(const _group of sorted) {
                const group = _group as { contents: AbstractedTrack[] };
                const any = group.contents[0];
                const metadata = sortingInstr.metadataCreator(any);
                entries.push({
                    flags: 256,
                    metadata,
                    oneElementLength: 128,
                    tracks: group.contents.map(e => e.systemIndex),
                });
            }
            const [tree, group] = contentDescriptionPairToFiles(this.allTracks, entries);
            this.database.parsedGroupInfoFiles[`03GINF${(fileIndex+1).toString().padStart(2, '0')}.DAT`] = group;
            this.database.parsedTreeFiles[`01TREE${(fileIndex+1).toString().padStart(2, '0')}.DAT`] = tree;
        }

        // Rebuild tree metadata (update total duration)
        this.database.globalContentInfoFile = this.allTracks.map(e => ({
            codecInfo: e.codecInfo,
            contents: {
                TIT2: e.title,
                TPE1: e.artist,
                TALB: e.album,
                TCON: e.genre,
                TSOP: e.artist,
            },
            encryptionState: e.encryptionState,
            oneElementLength: e.oneElementLength,
            trackDuration: e.trackDuration,
        }));
        let newDuration = this.allTracks.reduce((a, v) => a + v.trackDuration, 0);
        this.database.rewriteTotalDuration(this.lastTotalDuration, newDuration);
        this.lastTotalDuration = newDuration;
    }

    getTracksSortedArtistAlbum() : {
        __complexSortGroupedResult: 1,
        name: string,
        contents: {
            __complexSortGroupedResult: 1,
            name: string,
            contents: AbstractedTrack[]
        }[]
    }[] {
        return <any> complexSort([[{ var: 'artist' }], [{ var: 'album' }], [{ var: 'trackNumber' }]], this.allTracks.filter(e => e.trackDuration > 0));
    }

    async eraseAll() {
        // Essentially reinitialize the filesystem.
        // Destroy all audio files
        const fs = this.database.filesystem;
        // Due to how HIMDFilesystem abstraction works, delete() would immediately flush the FAT changes.
        // Here, they will be cached.
        const fsDelete = (fs instanceof UMSCNWJSFilesystem) ? fs.fatfs!.delete.bind(fs.fatfs) : fs.delete.bind(fs);
        async function recurseDelete(dir: string) {
            for(let file of await fs.list(dir)) {
                if(file.type === 'directory') {
                    await recurseDelete(file.name);
                } else {
                    await fsDelete(file.name);
                }
            }
            await fsDelete(dir);
        }

        await recurseDelete("/OMGAUDIO");
        if(fs instanceof UMSCNWJSFilesystem) {
            await fs.fatfs!.flushMetadataChanges()
        }

        await initializeNW(fs, this.deviceInfo.databaseParameters?.initLayers ?? []);
        this.database = new DatabaseManager(this.filesystem);
        await this.database.init();
        this._create();
    }

    async renameTrack(systemIndex: number, metadata: TrackMetadata) {
        this.allTracks[systemIndex - 1].album = metadata.album;
        this.allTracks[systemIndex - 1].artist = metadata.artist;
        this.allTracks[systemIndex - 1].title = metadata.title;
        this.allTracks[systemIndex - 1].trackNumber = metadata.trackNumber;
        // TODO: Is this necessary??
        // Update the metadata within the OMA file
        const handle = await this.database.filesystem.open(resolvePathFromGlobalIndex(systemIndex), 'rw');
        if(!handle) return;
        await updateMetadata(handle, metadata);
    }
}

// A "pair" here refers to the TREE and GROUP files together.
type ContentDescriptionPair = {
    flags: number,
    metadata: {[key: string]: string},
    oneElementLength: number,
    tracks: number[],
}[];

function contentDescriptionPairFromFiles(treeFile: TreeFile, groupFile: GroupEntry[]) {
    // Step 1: Parse GROUP file. Create `groups`:
    let groups: ContentDescriptionPair = groupFile.map(e => ({
        // TPLB / tree
        flags: -1,
        tracks: [],

        // GROUP:
        metadata: e.contents,
        oneElementLength: e.oneElementLength,
    }));

    let groupsSortedInLookupOrder = [...treeFile.mapStartBounds].sort((a, b) => b.firstTrackApplicableInTPLB - a.firstTrackApplicableInTPLB);

    // Step 2: Traverse trees - update groups one by one
    main: for(let i = 0; i<treeFile.tplb.length; i++) {
        let checkedIndex = i + 1;
        for(let group of groupsSortedInLookupOrder) {
            if (checkedIndex >= group.firstTrackApplicableInTPLB) {
                // Found!
                groups[group.groupInfoIndex - 1].flags = group.flags;
                groups[group.groupInfoIndex - 1].tracks.push(treeFile.tplb[i]);
                continue main;
            }
        }
        throw new Error("Group not found! Data is corrupted.");
    }
    return groups;
}

function contentDescriptionPairToFiles(allContentRef: AbstractedTrack[], content: ContentDescriptionPair): [TreeFile, GroupEntry[]] {
    // Assume pairs are sorted correctly.
    const tree: TreeFile = {
        mapStartBounds: [],
        tplb: [],
    };
    const groups: GroupEntry[] = content.map((etr, index) => {
        let obj: GroupEntry = {
            oneElementLength: 128,
            totalDuration: etr.tracks.reduce((p, c) => p + allContentRef[c - 1].trackDuration, 0),
            contents: etr.metadata,
        };
        tree.mapStartBounds.push({
            firstTrackApplicableInTPLB: tree.tplb.length + 1,
            flags: etr.flags,
            groupInfoIndex: index + 1,
        });
        tree.tplb.push(...etr.tracks);
        return obj;
    });

    return [tree, groups];
}
