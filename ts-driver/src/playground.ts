import { Connection } from "./connection.js";
import { encodeCommand } from "./encoder.js";

const conn = new Connection({
    host: "127.0.0.1",
    port: 3333,
    initialReconnectDelay: 200,
    maxReconnectDelay: 3000,
    reconnectFactor: 2
})

conn.on("state", (s) => console.log("[state]", s));
conn.on("error", (e) => console.log("[error]", e.message));
conn.on("reconnecting", (delay) => console.log(`[reconnect] coba lagi dalam ${delay}ms`));
conn.on("reply", (reply) => console.log("[reply]", reply));
conn.on("ready", () => console.log("[ready] terhubung"));
conn.on("close", () => console.log("[close] selesai"));

await conn.connect();
setInterval(() => {
  if (conn.currentState === "ready") conn.write(encodeCommand(["PING"]));
}, 2000);