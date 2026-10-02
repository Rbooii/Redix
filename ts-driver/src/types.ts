export type RespReply = 
    | {type: "simple", value: string}
    | { type: "error";   value: string }
    | { type: "integer"; value: number }
    | { type: "bulk";    value: string | null }
    | { type: "array";   value: RespReply[] | null };

export interface ParseResult {
  reply: RespReply;
  consumed: number; 
}