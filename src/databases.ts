import { getBEUint32, getBEUint32AsBytes } from "node-mass-storage";
import { HiMDFilesystem, getKBPS, getCodecName, HiMDCodecName } from "himd-js";

import { getUint16, readBytes, readUint16, readUint32, writeUint16, writeUint32 } from "./bytemanip";
import { encodeUTF16BEStringEA3 } from "./id3";
import { parseTable, TableFile, serializeTable } from "./tables";
import { assert } from "./utils";
import { DatabaseParameters } from "./devices";

const FILES_TO_LOAD = [
    // Group definition files:
    "01TREE01.DAT",
    "01TREE02.DAT",
    "01TREE03.DAT",
    "01TREE04.DAT",
    
    // Tree keyinfo file:
    "02TREINF.DAT",

    // Group string resource files:
    "03GINF01.DAT",
    "03GINF02.DAT",
    "03GINF03.DAT",
    "03GINF04.DAT",

    // Global content descriptor file:
    "04CNTINF.DAT",
]

const textEncoder = new TextEncoder();
const textDecoderStd = new TextDecoder();
const textDecoderUTF16 = new TextDecoder("UTF-16BE");

function readPackedTags(data: DataView, offset: number, elementsCount: number, elementLength: number): [{[key: string]: string}, number]{
    const contents: {[key: string]: string} = {};
    for(let i = 0; i<elementsCount; i++){
        let tagNameB, encodingType, rawContents;
        [tagNameB, offset] = readBytes(data, offset, 4);
        [encodingType, offset] = readUint16(data, offset);
        [rawContents, offset] = readBytes(data, offset, elementLength - 6);
        const tagName = textDecoderStd.decode(tagNameB);
        assert(encodingType === 2, "Invalid string encoding!");
        // Trim all zeros:
        let rawContentsStr = textDecoderUTF16.decode(rawContents);
        let newLength = rawContentsStr.length;
        while(rawContentsStr.charCodeAt(newLength - 1) === 0) --newLength;
        rawContentsStr = rawContentsStr.substring(0, newLength);
        contents[tagName] = rawContentsStr.trim();
    }
    return [contents, offset];
}

function writePackedTags(tags: {[key: string]: string}, elementLength: number){
    let offset = 0;
    let content = new Uint8Array(Object.keys(tags).length * elementLength)
    for(let [k, v] of Object.entries(tags)){
        if(k.startsWith("_")) continue;
        content.set(textEncoder.encode(k), offset);
        offset += 4;
        content.set(encodeUTF16BEStringEA3(v, true), offset + 1);
        offset += elementLength - 4;
    }

    return content;
}

export interface TreeFile {mapStartBounds: { firstTrackApplicableInTPLB: number, groupInfoIndex: number, flags: number }[], tplb: number[]}
export interface ContentEntry { encryptionState: Uint8Array, codecInfo: Uint8Array, trackDuration: number, oneElementLength: number, contents: {[key: string]: string}}
export interface GroupEntry {totalDuration: number, oneElementLength: number, contents: {[key: string]: string}};
export interface TrackMetadata {album: string, artist: string, title: string, genre: string, trackDuration: number, trackNumber: number}
export interface InboundTrackMetadata {album: string, artist: string, title: string, genre: string, trackNumber?: number }
export class DatabaseManager {
    tableFiles: {[fileName: string]: TableFile} = {}
    parsedTreeFiles: {[fileName: string]: TreeFile} = {};
    parsedGroupInfoFiles: {[fileName: string]: GroupEntry[]} = {};
    globalContentInfoFile: ContentEntry[] = [];

    constructor(public filesystem: HiMDFilesystem, private databaseParameters?: DatabaseParameters) {}

    async init(){
        for(let file of FILES_TO_LOAD) {
            const fd = await this.filesystem.open('OMGAUDIO/' + file, 'ro');
            const contents = await fd.read();
            const table = parseTable(contents);
            this.tableFiles[file] = table;

            if(file.startsWith("03GINF")){
                // Group info file. Parse it.
                // Make sure the format is readable
                assert(table.name === 'GPIF', "Invalid group info table name");
                assert(table.classes.length === 1, "Invalid class amount in GINF");
                assert(table.classes[0].className === "GPFB", "Invalid class name in GINF");
                // Known format - we're dealing with the standard map
                this.parsedGroupInfoFiles[file] = [];
                for(let entry of table.contents[0].elements){
                    // Read the header
                    const data = new DataView(entry.buffer);
                    let trackId, elementsCount, elementLength;
                    let offset = 8;
                    [trackId, offset] = readUint32(data, offset);
                    [elementsCount, offset] = readUint16(data, offset);
                    [elementLength, offset] = readUint16(data, offset);
                    assert(elementLength > 0x10, "The group info table does not make sense.");
                    // Read and parse every element
                    let contents;
                    [contents, offset] = readPackedTags(data, offset, elementsCount, elementLength);
                    // Bundle the info
                    this.parsedGroupInfoFiles[file].push({totalDuration: trackId, oneElementLength: elementLength, contents});
                }
            } else if(file.startsWith("01TREE")){
                // Tree file. Parse
                // Make sure the format is known / readable
                assert(table.name === "TREE", "Invalid root tree table name!");
                assert(table.classes.length === 2, "Invalid amount of classes in tree file!");
                assert(table.classes[0].className === "GPLB", "Invalid Groupinfo-match class in tree file!");
                assert(table.classes[1].className === "TPLB", "Invalid track index in tree file!");

                // Ok - format is good
                // Parse the entries.
                const gplbEntries: { firstTrackApplicableInTPLB: number, groupInfoIndex: number, flags: number }[] = [];
                for(let gplbEntry of table.contents[0].elements){
                    const data = new DataView(gplbEntry.buffer);
                    let offset = 0;
                    let groupInfoIndex, firstTrackApplicableInTPLB, flags;
                    [groupInfoIndex, offset] = readUint16(data, offset);
                    [flags, offset] = readUint16(data, offset);
                    [firstTrackApplicableInTPLB, offset] = readUint16(data, offset);
                    gplbEntries.push({ firstTrackApplicableInTPLB, flags, groupInfoIndex });
                }

                // Parse TPLB
                const tplbEntries = [];
                for(let e of table.contents[1].elements){
                    tplbEntries.push(getUint16(e));
                }

                this.parsedTreeFiles[file] = { mapStartBounds: gplbEntries, tplb: tplbEntries };
            }
        }

        // Parse global content info file.
        {
            const rootTable = this.tableFiles["04CNTINF.DAT"];
            assert(rootTable.name === 'CNIF', "Invalid root table name");
            assert(rootTable.classes.length === 1, "Invalid class amount in root");
            assert(rootTable.classes[0].className === "CNFB", "Invalid class name in root");
            for(let contentBlock of rootTable.contents[0].elements) {
                const data = new DataView(contentBlock.buffer);
                let zeros, encryptionState, codecInfo, trackId, elementsCount, elementLength, contents;
                let offset = 0;
                [zeros, offset] = readBytes(data, offset, 2);
                [encryptionState, offset] = readBytes(data, offset, 2);
                [codecInfo, offset] = readBytes(data, offset, 4);
                [trackId, offset] = readUint32(data, offset);
                [elementsCount, offset] = readUint16(data, offset);
                [elementLength, offset] = readUint16(data, offset);
                [contents, offset] = readPackedTags(data, offset, elementsCount, elementLength);
                assert(zeros.every(e => e === 0), "Unexpected data in root content block header");
                this.globalContentInfoFile.push({codecInfo, contents, oneElementLength: elementLength, encryptionState, trackDuration: trackId});
            }
        }
    }

    public reserializeTables(){
        // Write global content info file
        {
            const rootTable = this.tableFiles["04CNTINF.DAT"];
            rootTable.contents[0].elements = [];
            for(let contentBlock of this.globalContentInfoFile){
                const content = new Uint8Array(rootTable.contents[0].oneElementLength);
                let offset = 0;
                content.set([0, 0], offset);
                offset += 2;
                content.set(contentBlock.encryptionState, offset);
                offset += 2;
                content.set(contentBlock.codecInfo, offset);
                offset += 4;
                content.set(writeUint32(contentBlock.trackDuration), offset);
                offset += 4;
                content.set(writeUint16(Object.keys(contentBlock.contents).length), offset);
                offset += 2;
                content.set(writeUint16(contentBlock.oneElementLength), offset);
                offset += 2;
                // Write all entries
                content.set(writePackedTags(contentBlock.contents, contentBlock.oneElementLength), offset);
                rootTable.contents[0].elements.push(content);
            }
        }

        // Rebuild groupinfo
        for(let groupInfoFile in this.parsedGroupInfoFiles){
            const parsed = this.parsedGroupInfoFiles[groupInfoFile];
            const table = this.tableFiles[groupInfoFile];
            table.contents[0].elements = [];
            for(let element of parsed){
                let content = new Uint8Array(table.contents[0].oneElementLength).fill(0);
                let offset = 8;
                content.set(writeUint32(element.totalDuration), offset);
                offset += 4;
                content.set(writeUint16(Object.keys(element.contents).length), offset);
                offset += 2;
                content.set(writeUint16(element.oneElementLength), offset);
                offset += 2;
                content.set(writePackedTags(element.contents, element.oneElementLength), offset);
                table.contents[0].elements.push(content);
            }
        }

        // Rebuild trees
        for(let treeFile in this.parsedTreeFiles){
            const parsed = this.parsedTreeFiles[treeFile];
            const table = this.tableFiles[treeFile];
            table.contents[0].elements = [];
            // Serialize the maps
            for(let mapEntry of parsed.mapStartBounds){
                const entry = new Uint8Array(table.contents[0].oneElementLength);
                let offset = 0;
                entry.set(writeUint16(mapEntry.groupInfoIndex), offset);
                offset += 2;
                entry.set(writeUint16(mapEntry.flags), offset);
                offset += 2;
                entry.set(writeUint16(mapEntry.firstTrackApplicableInTPLB), offset);
                table.contents[0].elements.push(entry);
            }

            // Serialize the tplb
            table.contents[1].elements = [];
            for(let tplbEntry of parsed.tplb){
                table.contents[1].elements.push(writeUint16(tplbEntry));
            }
        }
    }

    public async rewriteTables(){
        this.reserializeTables();
        for(let filename in this.tableFiles){
            const tableContents = serializeTable(this.tableFiles[filename], filename.startsWith("01TREE"));
            const fd = await this.filesystem.open("OMGAUDIO/" + filename, 'rw');
            await fd.write(tableContents);
            await fd.close();
        }
    }

    protected getGlobalTrack(track: number) {
        const globalTrack = this.globalContentInfoFile[track - 1];
        const codecId = globalTrack.codecInfo[0];
        const codecParams = globalTrack.codecInfo.slice(1);
        const codecInfo = { codecId, codecInfo: codecParams };
        const codecName = getCodecName(codecInfo);
        const codecKBPS = getKBPS(codecInfo);

        return {
            album: globalTrack.contents['TALB'],
            artist: globalTrack.contents['TPE1'],
            genre: globalTrack.contents['TCON'],
            title: globalTrack.contents['TIT2'],
            duration: Math.ceil(globalTrack.trackDuration / 1000),
            codecName, codecKBPS,
        };
    }

    public rewriteTotalDuration(oldValue: number, newValue: number) {
        const newKeyAsUint = getBEUint32AsBytes(newValue);
        for(let entry of this.tableFiles["02TREINF.DAT"].contents[0].elements.slice(0, 4)){
            // After index 4, there be dragons
            if(getBEUint32(entry.slice(8, 8+4)) === oldValue){
                entry.set(newKeyAsUint, 8);
            }
        }
    }

    // TODO: TRACK ORDERING

    public listContentGroups(): { groupName: string | null, contents: { title: string, artist: string, genre: string, album: string, duration: number, codecName: HiMDCodecName, codecKBPS: number }[]}[] {
        const groupedEncountered: number[] = [];
        const groups: { groupName: string | null, contents: { title: string, artist: string, genre: string, album: string, duration: number, codecName: HiMDCodecName, codecKBPS: number }[]}[] = [];
        // 01TREE01.DAT is groups
        const tree = this.parsedTreeFiles["01TREE01.DAT"];
        const desc = this.parsedGroupInfoFiles["03GINF01.DAT"];

        for(let trackIndex = 0; trackIndex < tree.tplb.length; trackIndex++) {
            const track = tree.tplb[trackIndex];
            let gplbEntry = -1;
            // If Sony can depend on GPLBs being ordered correctly, so can I.
            for(let i = tree.mapStartBounds.length - 1; i >= 0; i--) {
                const gplb = tree.mapStartBounds[i];
                if((trackIndex+1) >= gplb.firstTrackApplicableInTPLB){
                    gplbEntry = gplb.groupInfoIndex;
                    break;
                }
            }
            if(gplbEntry !== -1){
                groupedEncountered.push(track);
                if(groups.length < gplbEntry) {
                    groups.push({ groupName: desc[gplbEntry - 1].contents['TIT2'], contents: [] });
                }
                groups[gplbEntry - 1].contents.push(this.getGlobalTrack(track));
            }
        }

        let ungrouped = Array(this.globalContentInfoFile.length).fill(0).map((_, i) => i + 1).filter(e => !groupedEncountered.includes(e));
        const ungroupedGroup = { groupName: null, contents: ungrouped.map(this.getGlobalTrack.bind(this))};
        groups.splice(0, 0, ungroupedGroup);

        return groups;
    }

    public listContentArtists(): {[artist: string]: {[album: string]: {track: string, index: -1, duration: number, codecName: HiMDCodecName, codecKBPS: number }[]}} {
        const artists: {[artist: string]: {[album: string]: {track: string, index: -1, duration: number, codecName: HiMDCodecName, codecKBPS: number}[]}} = {};

        for(let i = 1; i<=this.globalContentInfoFile.length; i++) {
            const track = this.getGlobalTrack(i);
            if(!(track.artist in artists)) {
                artists[track.artist] = {};
            }
            const artist = artists[track.artist]!;
            if(!(track.album in artist)) {
                artist[track.album] = [];
            }
            const album = artist[track.album];
            album.push({
                track: track.title,
                index: -1,
                duration: track.duration,
                codecName: track.codecName,
                codecKBPS: track.codecKBPS,
            });
        }

        return artists;
    }
}
