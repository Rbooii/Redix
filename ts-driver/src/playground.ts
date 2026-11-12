import { Redix } from "./client.js";

const redix = new Redix({
    host: "127.0.0.1",
    port: 3333,
    // password: "secret",
    initialReconnectDelay: 200,
    maxReconnectDelay: 3000,
    reconnectFactor: 2,
});

redix.on("state", (s) => console.log("[state]", s));
redix.on("error", (e) => console.log("[error]", e.message));
redix.on("reconnecting", (delay) => console.log(`[reconnect] coba lagi dalam ${delay}ms`));
redix.on("ready", () => console.log("[ready] terhubung"));
redix.on("close", () => console.log("[close] selesai"));

await redix.connect();
await redix.set("playground", "hello from typescript");
console.log("[get]", await redix.get("playground"));
console.log("[ping]", await redix.ping());

setInterval(() => {
  void redix.ping().catch((err: Error) => console.log("[ping error]", err.message));
}, 2000);
