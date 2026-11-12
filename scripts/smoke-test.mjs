import net from "node:net";

const host = process.env.REDIX_HOST ?? "127.0.0.1";
const port = Number(process.env.REDIX_PORT ?? "3333");
const deadline = Date.now() + 5000;

async function pingOnce() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = "";
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timer = setTimeout(() => {
      socket.destroy();
      finish(new Error("timed out waiting for PONG"));
    }, 1000);

    socket.on("connect", () => {
      socket.write("*1\r\n$4\r\nPING\r\n");
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer === "+PONG\r\n") {
        finish();
        socket.end();
      }
    });

    socket.on("error", (error) => {
      finish(error);
    });

    socket.on("close", () => {
      finish(new Error(`unexpected close, received ${JSON.stringify(buffer)}`));
    });
  });
}

for (;;) {
  try {
    await pingOnce();
    console.log(`PONG from ${host}:${port}`);
    process.exit(0);
  } catch (error) {
    if (Date.now() >= deadline) {
      console.error(`smoke-test: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
