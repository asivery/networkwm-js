import fs from 'fs';
import { decryptOMA } from '../tagged-oma';

export function main(invocation: string, args: string[]){
    if(args.length < 2) {
        console.log(`Usage: ${invocation} <source OMA> <destination OMA>`);
        return;
    }
    const [source, dest] = args;
    if(!fs.existsSync(source)){
        console.log("Source does not exist!");
        return;
    }
    if(fs.existsSync(dest)){
        console.log("Destination file exists!");
        return;
    }
    fs.writeFileSync(dest, decryptOMA(new Uint8Array(fs.readFileSync(source))));
}
