export type ComplexSortGroupedResult<T> =
  | T[]
  | { name: string, contents: ComplexSortGroupedResult<T>, __complexSortGroupedResult: 1 }[];

export type ComplexSortFormatPart = { var: string } | { literal: string };

export function complexSort<T>(
    format: ComplexSortFormatPart[][],
    data: T[]
): ComplexSortGroupedResult<T> {
    function createFieldForFormat(format: ComplexSortFormatPart[], entry: any): [string, string[]] {
        let str = "";
        let vars = [];
        for(let e of format as any){
            if(e.var) {
                let v = entry[e.var];
                if(typeof v === 'number') {
                    v = v.toString().padStart(5, '0');
                }
                str += v;
                vars.push(v);
            } else if(e.literal) {
                str += e.literal;
            }
        }
        return [str, vars];
    }
    const formatEntry = format[0];
    if(format.length === 1) {
        // This is the last fragment. Simply compute it
        return [...data].sort((a, b) => createFieldForFormat(formatEntry, a)[0].localeCompare(createFieldForFormat(formatEntry, b)[0]));
    } else {
        // Take the first format, create groups, then recurse
        const nextFormat = format.slice(1);
        const formatCompliance = formatEntry.filter((e: any) => e.var).map((e: any) => <string> e.var);
        return data
            .map(e => createFieldForFormat(formatEntry, e))
            .sort((a, b) => a[0].localeCompare(b[0]))
            .reduce<[string, string[]][]>((p, c) => (!p.some(e => e[1].every((z: string, i: number) => c[1][i] === z)) ? [...p, c] : p), [])
            .map(e => ({
                __complexSortGroupedResult: 1 as const,
                name: e[0],
                contents: complexSort(nextFormat,
                    data.filter((z: any) => formatCompliance
                                            .map(q => z[q])
                                            .every((f, i) => f === e[1][i]))
                )
            }));
    }
}

export function flatten<T>(data: ComplexSortGroupedResult<T>): T[] {
    let finalArray: T[] = [];
    if(!data.length) return finalArray;
    if((<any> data[0]).__complexSortGroupedResult == 1) {
        // This is a nested result
        for(let subContent of <{contents: ComplexSortGroupedResult<T>}[]>data) {
            finalArray.push(...flatten(subContent.contents));
        }
    } else {
        // Normal
        finalArray.push(...<T[]>data);
    }

    return finalArray;
}
