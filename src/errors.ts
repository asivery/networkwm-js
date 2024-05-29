export class NWJSError extends Error {
    constructor(m: string) {
        super(m);
        Object.setPrototypeOf(this, NWJSError.prototype);
    }
}
