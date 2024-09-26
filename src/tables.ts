import { readBytes, readUint16, readUint32, readUint8, readString, align, writeUint32, writeUint16 } from './bytemanip';
import { arrayEq, assert } from './utils';

export interface TableClassDefinition {
    className: string;
    startAddress: number;
    classLength: number;
    _overrideMinimalClassLength?: number;
}

export interface TableClassContents {
    className: string;
    oneElementLength: number;
    elements: Uint8Array[];
    startAddress: number;
}

export interface TableFile {
    name: string;
    classes: TableClassDefinition[];
    contents: TableClassContents[]
}

export function parseTable(tableFileContents: Uint8Array): TableFile {
    const dataView = new DataView(tableFileContents.buffer);
    let offset = 0;
    // Now in root:
    let tableName, constant01010000, classDefinitionCount;
    [tableName, offset] = readString(dataView, offset, 4);
    [constant01010000, offset] = readBytes(dataView, offset, 4);
    assert(arrayEq(new Uint8Array([0x01, 0x01, 0x00, 0x00]), constant01010000));
    [classDefinitionCount, offset] = readUint8(dataView, offset);
    offset = align(offset, 0x10);
    // Now in class definitions:
    const classDefinitions: TableClassDefinition[] = [];
    const classContents: TableClassContents[] = [];
    for(let i = 0; i<classDefinitionCount; i++) {
        let className, startAddress, classLength;
        [className, offset] = readString(dataView, offset, 4);
        [startAddress, offset] = readUint32(dataView, offset);
        [classLength, offset] = readUint32(dataView, offset);
        offset = align(offset, 0x10);
        classDefinitions.push({classLength, className, startAddress});
    }
    // Now read every definition. Seek to start address.
    for(let definition of classDefinitions) {
        offset = definition.startAddress;
        let className, elementsCount, elementLength, elementsCount2;
        const elements: Uint8Array[] = [];
        [className, offset] = readString(dataView, offset, 4);
        [elementsCount, offset] = readUint16(dataView, offset);
        [elementLength, offset] = readUint16(dataView, offset);
        offset += 2;
        [elementsCount2, offset] = readUint16(dataView, offset);
        offset = align(offset, 0x10);
        // assert(elementsCount2 == elementsCount);
        for(let i = 0; i<elementsCount; i++){
            let element;
            [element, offset] = readBytes(dataView, offset, elementLength);
            elements.push(element);
        }
        classContents.push({ startAddress: definition.startAddress, className, oneElementLength: elementLength, elements });
    }
    
    return { classes: classDefinitions, contents: classContents, name: tableName };
}

export function serializeTable(tableFile: TableFile, writeSecondLength = true): Uint8Array {
    const textEncoder = new TextEncoder();
    
    // Recalculate lengths and starting addresses.
    for(let i = 0; i<tableFile.classes.length; i++){
        // Calculate real length
        let contentLength = tableFile.contents[i].elements.length * tableFile.contents[i].oneElementLength + 0x10; // 0x10 for the content header.
        if(contentLength % 16 !== 0){
            contentLength += 16 - (contentLength % 16);
        }
        if(tableFile.classes[i]._overrideMinimalClassLength) {
            contentLength = Math.max(contentLength, tableFile.classes[i]._overrideMinimalClassLength!);
        }
        if(tableFile.classes[i].classLength < contentLength){
            let difference = contentLength - tableFile.classes[i].classLength;
            tableFile.classes[i].classLength = contentLength;
            for(let j = i+1; j<tableFile.classes.length; j++) {
                tableFile.classes[j].startAddress += difference;
                tableFile.contents[j].startAddress += difference;
            }
        }
    }

    const size = Math.max.apply(null, tableFile.classes.map(e => e.startAddress + e.classLength));
    const data = new Uint8Array(size).fill(0);
    // Serialize the main header.
    data.set(textEncoder.encode(tableFile.name), 0);
    data.set(new Uint8Array([0x01, 0x01, 0x00, 0x00]), 4);
    data[8] = tableFile.classes.length;
    let offset = 0x10;
    // Write all class definitions.
    for(let classDef of tableFile.classes){
        data.set(textEncoder.encode(classDef.className), offset);
        offset += 4;
        data.set(writeUint32(classDef.startAddress), offset);
        offset += 4;
        data.set(writeUint32(classDef.classLength), offset);
        offset += 8;
    }
    for(let classContent of tableFile.contents){
        offset = classContent.startAddress;
        data.set(textEncoder.encode(classContent.className), offset);
        offset += 4;
        data.set(writeUint16(classContent.elements.length), offset);
        offset += 2;
        data.set(writeUint16(classContent.oneElementLength), offset);
        offset += 4;
        if(writeSecondLength) data.set(writeUint16(classContent.elements.length), offset);
        offset += 6;
        for(let e of classContent.elements){
            data.set(e, offset);
            offset += e.length;
        }
    }
    return data;
}
