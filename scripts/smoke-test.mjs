import net from "node:net";

const host = process.env.REDIX_HOST ?? "127.0.0.1";
const port = Number(process.env.REDIX_PORT ?? "3333");

const socket = net.createConnection({ host, port });
let buffer = "";
let done = false;

const timer = setTimeout(() => fail("timed out waiting for PONG"), 3000);

socket.on("connect", () => {
  socket.write("*1\r\n$4\r\nPING\r\n");
});

socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  if (buffer !== "+PONG\r\n") {
    return;
  }

  done = true;
  clearTimeout(timer);
  console.log(`PONG from ${host}:${port}`);
  socket.end();
});

socket.on("error", (error) => {
  fail(error.message);
});

socket.on("close", () => {
  if (!done) {
    fail(`unexpected close, received ${JSON.stringify(buffer)}`);
  }
});

function fail(message) {
  if (done) {
    return;
  }
  done = true;
  clearTimeout(timer);
  console.error(`smoke-test: ${message}`);
  process.exit(1);
}
