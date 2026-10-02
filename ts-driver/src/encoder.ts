export function encodeCommand(args: readonly string[]): Buffer {
    if(args.length === 0) {
        throw new Error("encodeCommand: command cannot be empty");
    }
    const parts: Buffer[] = [];
    //header
    parts.push(Buffer.from(`*${args.length}\r\n`, "utf8"));
    for(const arg of args){
        const byteLen = Buffer.byteLength(arg, "utf8");
        parts.push(Buffer.from(`$${byteLen}\r\n`, "utf8"));
        parts.push(Buffer.from(arg, "utf8"));
        parts.push(Buffer.from("\r\n", "utf8"));
    }
    return Buffer.concat(parts);
}