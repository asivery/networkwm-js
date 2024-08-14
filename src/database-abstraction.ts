import { CodecInfo } from "himd-js";
import { DatabaseManager, GroupEntry, TrackMetadata, TreeFile } from "./databases";
import { complexSort, ComplexSortFormatPart } from "./sort";

type AbstractedTrack = TrackMetadata & {
    encryptionState: Uint8Array,
    codecInfo: Uint8Array,
    oneElementLength: number,
    systemIndex: number,
};

export class DatabaseAbstraction {
    private content1ArtistAlbumTrack: ContentDescriptionPair;
    private allTracks: AbstractedTrack[] = [];
    private lastTotalDuration: number = 0;
    public constructor(public database: DatabaseManager) {
        this.content1ArtistAlbumTrack = contentDescriptionPairFromFiles(
            database.parsedTreeFiles["01TREE03.DAT"],
            database.parsedGroupInfoFiles["03GINF03.DAT"],
        );
        this.create();
        console.log(complexSort([[{ var: 'TPE1' }, { literal: ' - '}, { var: 'TALB'}], [{ var: 'TALB'}], [{var: 'TIT2'}]], database.globalContentInfoFile.map(e => e.contents)));
    }

    private create() {
        // Parse the group info file.
        this.lastTotalDuration = 0;
        this.allTracks = this.database.globalContentInfoFile.map((globalEntry, systemIndex) => {
            // Locate the track index
            const trackIndex = this.content1ArtistAlbumTrack.find(e => e.tracks.includes(systemIndex + 1))?.tracks.indexOf(systemIndex + 1) ?? 1;
            this.lastTotalDuration += globalEntry.trackDuration;
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
            };
        });
    }

    public addNewTrack(trackInfo: TrackMetadata, codecInfo: CodecInfo) {
        const newObject: AbstractedTrack = {
            ...trackInfo,
            codecInfo: new Uint8Array([codecInfo.codecId, ...codecInfo.codecInfo.subarray(0, 3)]),
            encryptionState: new Uint8Array([0, 1]),
            oneElementLength: 128,
            systemIndex: -1,
        };
        const idx = this.allTracks.push(newObject);
        newObject.systemIndex = idx;
        return newObject.systemIndex;
    }

    public reserializeDatabase() {
        // TREE01 - {album} - {trackIndex}
        type ReserializationInstruction = {
            metadataCreator: (track: AbstractedTrack) => {[key: string]: string},
            sorting: ComplexSortFormatPart[][]
        };
        
        const instrs: ReserializationInstruction[] = [
            // TREE01 - Groups (I use [aritst - album] > [trackIndex])
            {
                metadataCreator: e => ({
                    TIT2: e.album,
                    TPE1: e.artist,
                    TCON: '',
                    TSOP: '',
                    PICP: '',
                    PIC0: '',
                }),
                sorting: [[{ var: 'artist' }, { literal: '-----'}, { var: 'album' }], [{ var: 'trackIndex'}]],
            },
            // TREE02 - [artist] > [title]
            {
                metadataCreator: e => ({ TIT2: e.artist }),
                sorting: [[{ var: 'artist' }], [{ var: 'title'}]],
            },
            // TREE03 - [album] > [trackIndex]
            {
                metadataCreator: e => ({ TIT2: e.album }),
                sorting: [[{ var: 'album' }], [{ var: 'trackIndex' }]],
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
            const sorted = complexSort(sortingInstr.sorting, this.allTracks);
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
