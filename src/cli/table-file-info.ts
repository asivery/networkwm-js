import { parseTable } from "../tables";
import { Logger, hexDump as _hexDump } from "../utils";
import fs from 'fs';

const logger = new Logger();
const log = logger.log.bind(logger);
const bumpIndent = logger.bumpIndent.bind(logger);
const hexDump = _hexDump.bind(null, log);


export function main(invocation: string, args: string[]){
    const file = args[0];
    if(!file){
        console.log(`Usage: ${invocation} <table file>`);
        return;
    }
    const treeFileContents = new Uint8Array(fs.readFileSync(file));
    const parsedTree = parseTable(treeFileContents);
    log(`Name: ${parsedTree.name}`);
    log(`Classes defined:`);
    bumpIndent(1);
    for(const klass of parsedTree.classes) {
        log(`Class ${klass.className} - starts at 0x${klass.startAddress.toString(16)}, 0x${klass.classLength.toString(16)} bytes long`);
    }
    bumpIndent(-1);
    log(`Classes' contents:`);
    bumpIndent(1);
    for(const content of parsedTree.contents) {
        log(`${content.className}:`)
        bumpIndent(1);
        log(`Starts at: 0x${content.startAddress.toString(16)}`);
        log(`One element is 0x${content.oneElementLength.toString(16)} bytes long`);
        for(let i = 0; i<content.elements.length; i++) {
            log(`Elements[${i}]:`);
            bumpIndent(1);
            hexDump(content.elements[i]);
            bumpIndent(-1);
        }
        bumpIndent(-1);
    }
    bumpIndent(-1);
}
