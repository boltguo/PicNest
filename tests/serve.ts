import { createServer } from "node:http";
import { fixture } from "./helpers";

// A disposable real Worker/D1/R2/DO instance; never uses deployment bindings.
const f = await fixture();
const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await f.mf.dispatchFetch(
      `http://127.0.0.1:8787${request.url}`,
      {
        method: request.method,
        headers: request.headers as Record<string, string>,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        redirect: "manual",
      },
    );
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error);
    response.writeHead(500);
    response.end();
  }
});
server.listen(8787, "127.0.0.1");
async function close() {
  server.close();
  await f.dispose();
  process.exit(0);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
