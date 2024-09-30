#!/usr/bin/env node
import { main as tableMain } from './cli/table-file-info';
import { main as omaMain } from './cli/tagged-oma-info';
import { main as omaDecryptMain } from './cli/decrypt-oma';
import { mainDeriveKey as mp3DeriveKeyMain } from './cli/decrypt-mp3';
import { main as mp3DecryptMain } from './cli/decrypt-mp3';

import { basename } from 'path';

interface CliCommand {
    name: string;
    root: (invocation: string, args: string[]) => (void | Promise<void>);
}

const commands: CliCommand[] = [
    {
        name: 'table-info',
        root: tableMain,
    },
    {
        name: 'oma-info',
        root: omaMain,
    },
    {
        name: 'decrypt-oma',
        root: omaDecryptMain,
    },
    {
        name: 'derive-mp3-key',
        root: mp3DeriveKeyMain,
    },
    {
        name: 'decrypt-mp3',
        root: mp3DecryptMain,
    },
];

async function main(){
    const subcommand = process.argv[2]?.toLowerCase();
    const args = process.argv.slice(3);
    const def: CliCommand | undefined = commands.find(e => e.name.toLowerCase() === subcommand);
    if(!def) {
        console.log(`Usage ${basename(process.argv[1])} <subcommand> [...arguments], where subcommand is one of:`);
        commands.forEach(e => console.log(`- ${e.name}`));
        return;
    }
    const result = def.root(`${process.argv[1]} ${subcommand}`, args);
    await result;
}

main().then(() => process.exit(0));
