import { getBEUint32, getBEUint32AsBytes } from "node-mass-storage";
import { CodecInfo, HiMDFilesystem } from "himd-js";

import { getUint16, readBytes, readUint16, readUint32, writeUint16, writeUint32 } from "./bytemanip";
import { encodeUTF16BEStringEA3 } from "./id3";
import { parseTable, TableFile, serializeTable } from "./tables";
import { assert } from "./utils";

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
        content.set(textEncoder.encode(k), offset);
        offset += 4;
        content.set(encodeUTF16BEStringEA3(v, true), offset + 1);
        offset += elementLength - 4;
    }

    return content;
}

export class DatabaseManager {
    tableFiles: {[fileName: string]: TableFile} = {}
    parsedTreeFiles: {[fileName: string]: {mapStartBounds: { firstTrackApplicableInTPLB: number, groupInfoIndex: number, flags: number }[], tplb: number[]}} = {};
    parsedGroupInfoFiles: {[fileName: string]: {trackId: number, oneElementLength: number, contents: {[key: string]: string}}[]} = {};
    globalContentInfoFile: { encryptionState: Uint8Array, codecInfo: Uint8Array, trackId: number, oneElementLength: number, contents: {[key: string]: string}}[] = [];

    constructor(public himdFilesystem: HiMDFilesystem) {

    }

    async init(){
        for(let file of FILES_TO_LOAD) {
            const fd = await this.himdFilesystem.open('OMGAUDIO/' + file, 'ro');
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
                    this.parsedGroupInfoFiles[file].push({trackId, oneElementLength: elementLength, contents});
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
                this.globalContentInfoFile.push({codecInfo, contents, oneElementLength: elementLength, encryptionState, trackId});
            }
        }
    }

    protected reserializeTables(){
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
                content.set(writeUint32(contentBlock.trackId), offset);
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
                content.set(writeUint32(element.trackId), offset);
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
            const fd = await this.himdFilesystem.open("OMGAUDIO/" + filename, 'rw');
            await fd.write(tableContents);
            await fd.close();
        }
    }

    public addNewTrack(titleInfo: {album: string, artist: string, title: string, genre: string}, key: number, codecInfo: CodecInfo) {
        // Form new contents entry
        const contentsEntry = {
            codecInfo: new Uint8Array([codecInfo.codecId, ...codecInfo.codecInfo.subarray(0, 3)]),
            contents:{
                TIT2: titleInfo.title,
                TPE1: titleInfo.artist,
                TALB: titleInfo.album,
                TCON: titleInfo.genre,
                TSOP: titleInfo.artist,
            },
            oneElementLength: 128,
            encryptionState: new Uint8Array([0, 1]),
            trackId: key,
        };

        // Rewrite the tree info files
        // We'll need to know the current (old) global key for that
        const oldGlobalKey = this.globalContentInfoFile.reduce((a, b) => a + b.trackId, 0);

        // Now that we know the old global key, we can push this track to the global list.
        const newGlobalIndex = this.globalContentInfoFile.push(contentsEntry);

        const newKeyAsUint = getBEUint32AsBytes(oldGlobalKey + contentsEntry.trackId);
        for(let entry of this.tableFiles["02TREINF.DAT"].contents[0].elements.slice(0, 4)){
            // After index 4, there be dragons
            if(getBEUint32(entry.slice(8, 8+4)) === oldGlobalKey){
                entry.set(newKeyAsUint, 8);
            }
        }

        // Rewrite the tree files.

        // Tree01 is just groups, so we can add this new track to a new group.
        const newGroup = {
            trackId: contentsEntry.trackId,
            oneElementLength: 128,
            contents: {
                TIT2: 'New Group (NWJS)',
                TPE1: '',
                TCON: '',
                TSOP: '',
                PICP: '',
                PIC0: '',
            },
        };
        const newGroupIndex = this.parsedGroupInfoFiles["03GINF01.DAT"].push(newGroup) - 1;
        const tplbIndex = this.parsedTreeFiles["01TREE01.DAT"].tplb.push(newGlobalIndex) - 1;
        this.parsedTreeFiles["01TREE01.DAT"].mapStartBounds.push({firstTrackApplicableInTPLB: tplbIndex + 1, flags: 0x100, groupInfoIndex: newGroupIndex + 1 });

        const newResolvedStrings = [ null, null, `${titleInfo.artist} - ${titleInfo.title}`, `${titleInfo.album} - ${titleInfo.title}`, `${titleInfo.genre} - ${titleInfo.title}`, ]
        const newResolvedEntries = [ null, null, titleInfo.artist, titleInfo.album, titleInfo.genre ];
        for(let i = 2; i<5; i++){
            const treeFile = this.parsedTreeFiles[`01TREE0${i}.DAT`];
            const descFile = this.parsedGroupInfoFiles[`03GINF0${i}.DAT`];
            
            let thisEntryIndex = descFile.findIndex(e => e.contents.TIT2 === newResolvedEntries[i]);
            let needsWriteGPLB = false;
            if(thisEntryIndex === -1){
                needsWriteGPLB = true;
                thisEntryIndex = descFile.push({ trackId: 0, contents: { TIT2: newResolvedEntries[i]! }, oneElementLength: 128 }) - 1;
            }
            descFile[thisEntryIndex].trackId += key;

            const sortedGPLBEntries = treeFile.mapStartBounds.map((e, i) => [e, i] as [typeof e, number]).sort((a, b) => b[0].firstTrackApplicableInTPLB - a[0].firstTrackApplicableInTPLB);

            // Find the first track that is lesser than 
            let newIndexInTPLB = -1;
            let gplbEntryMatching = null;
            for(let tplbIndex = 0; tplbIndex < treeFile.tplb.length; tplbIndex++){
                gplbEntryMatching = null;
                for(let j = 0; j<sortedGPLBEntries.length; j++){
                    if((tplbIndex+1) >= sortedGPLBEntries[j][0].firstTrackApplicableInTPLB){
                        // It's this one
                        gplbEntryMatching = sortedGPLBEntries[j][1];
                        break;
                    }
                }
                assert(gplbEntryMatching !== null, `Couldn't find matching TPLB => GPLB[root] entry ${i}`);
                let parentString = descFile[treeFile.mapStartBounds[gplbEntryMatching!].groupInfoIndex - 1].contents.TIT2;
                let str = `${parentString} - ${this.globalContentInfoFile[treeFile.tplb[tplbIndex] - 1].contents.TIT2}`
                if(newResolvedStrings[i]! < str){
                    newIndexInTPLB = tplbIndex;
                    break;
                }
            }
            if(newIndexInTPLB === -1){
                newIndexInTPLB = treeFile.tplb.push(newGlobalIndex) - 1;
            }else{
                // The new entry lives at this index.
                treeFile.tplb.splice(newIndexInTPLB, 0, newGlobalIndex);
            }
            treeFile.mapStartBounds.forEach((e, i) => {
                // TODO: Does this make sense?
                if(i === thisEntryIndex) return;
                if(e.firstTrackApplicableInTPLB >= (newIndexInTPLB + 1)) e.firstTrackApplicableInTPLB++;
            });

            if(needsWriteGPLB){
                treeFile.mapStartBounds.push({firstTrackApplicableInTPLB: newIndexInTPLB + 1, flags: 0x100, groupInfoIndex: thisEntryIndex + 1});
            }

            // GPLBs need to be ordererd by the first track they're applicable to
            // Otherwise all hell breaks loose.
            treeFile.mapStartBounds.sort((a, b) => a.firstTrackApplicableInTPLB - b.firstTrackApplicableInTPLB);
        }

        return newGlobalIndex;
    }

    public listContent(): { groupName: string | null, contents: { title: string, artist: string, genre: string, album: string }[]}[] {
        const groupedEncountered: number[] = [];
        const groups: { groupName: string | null, contents: { title: string, artist: string, genre: string, album: string }[]}[] = [];
        // 01TREE01.DAT is groups
        const tree = this.parsedTreeFiles["01TREE01.DAT"];
        const desc = this.parsedGroupInfoFiles["03GINF01.DAT"];

        const getGlobalTrack = (track: number) => {
            const globalTrack = this.globalContentInfoFile[track - 1];
            return {
                album: globalTrack.contents['TALB'],
                artist: globalTrack.contents['TPE1'],
                genre: globalTrack.contents['TCON'],
                title: globalTrack.contents['TIT2'],
            };
        }

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
                    groups.push({ groupName: desc[gplbEntry - 1].contents['TIT2'], contents: []});
                }
                groups[gplbEntry - 1].contents.push(getGlobalTrack(track));
            }
        }

        let ungrouped = Array(this.globalContentInfoFile.length).fill(0).map((_, i) => i + 1).filter(e => !groupedEncountered.includes(e));
        const ungroupedGroup = { groupName: null, contents: ungrouped.map(getGlobalTrack)};
        groups.splice(0, 0, ungroupedGroup);

        return groups;
    }
}
