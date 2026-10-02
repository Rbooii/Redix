import type { ParseResult, RespReply } from "./types.js";

const CRLF = "\r\n";

function findCrlf(buf: Buffer, offset: number): number {
    return buf.indexOf(CRLF, offset, "utf8");
}

function parseNumberLine(buf: Buffer, offset: number): {
    value: number;
    next: number
} | null {
    const LineEnd = findCrlf(buf, offset);
    if (LineEnd === -1) return null;
    const text = buf.toString("utf8", offset, LineEnd);
    if (!/^-?\d+$/.test(text)) {
        throw new Error(`RESP: angka tidak valid "${text}"`);
    }
    return { value: Number(text), next: LineEnd + 2 };
}

export function tryParseReply(buf: Buffer, offset = 0): ParseResult | null {
    if (offset >= buf.length) return null;
    const type = String.fromCharCode(buf[offset]);
    switch (type) {
        case "+":
        case "-": {
            const LineEnd = findCrlf(buf, offset + 1);
            if (LineEnd === -1) return null;
            const value = buf.toString("utf8", offset + 1, LineEnd);
            const reply: RespReply = type === "+" ? { type: "simple", value } : { type: "error", value };
            return { reply, consumed: LineEnd + 2 - offset };
        }

        case ":": {
            const num = parseNumberLine(buf, offset + 1);
            if (!num) return null;
            return {
                reply: { type: "integer", value: num.value },
                consumed: num.next - offset,
            };
        }
        case "$": {
            const num = parseNumberLine(buf, offset + 1);
            if (!num) return null;

            if (num.value < 0) {
                // $-1 = null bulk string
                return { reply: { type: "bulk", value: null }, consumed: num.next - offset };
            }

            const dataStart = num.next;
            const dataEnd = dataStart + num.value;

            if (dataEnd + 2 > buf.length) return null; // data atau CRLF penutup belum lengkap

            const value = buf.toString("utf8", dataStart, dataEnd);
            return { reply: { type: "bulk", value }, consumed: dataEnd + 2 - offset };
        }
        case "*": {
            const num = parseNumberLine(buf, offset + 1);
            if (!num) return null;

            if (num.value < 0) {
                // *-1 = null array
                return { reply: { type: "array", value: null }, consumed: num.next - offset };
            }

            const items: RespReply[] = [];
            let cursor = num.next;

            for (let i = 0; i < num.value; i++) {
                const element = tryParseReply(buf, cursor);
                if (!element) return null; // satu elemen belum lengkap -> seluruh array belum lengkap
                items.push(element.reply);
                cursor += element.consumed;
            }

            return { reply: { type: "array", value: items }, consumed: cursor - offset };
        }
        default:
            throw new Error(`RESP: reply type is not recognized "${type}"`);
    }
}