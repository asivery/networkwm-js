#!/usr/bin/env node
import { main as tableMain } from './cli/table-file-info';
import { main as omaMain } from './cli/tagged-oma-info';
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
    }
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
