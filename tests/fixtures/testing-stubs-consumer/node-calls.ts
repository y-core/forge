// The node calls the fleet's tests make, each in the shape one app's local stub declared before it adopted `testing/node`.
import "node:domain";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import process, { argv, env, execPath, exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const url: URL = pathToFileURL(here);
const text: string = readFileSync(new URL("./a.txt", import.meta.url), "utf-8");
const utf8: string = readFileSync(join(here, "a.txt"), "utf8");
const bytes: Uint8Array = readFileSync(resolve(here, "a.bin"));
const names: string[] = readdirSync(url);
const made: string | undefined = mkdirSync(join(here, "out"), { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "stubs-"));
writeFileSync(join(scratch, "a.txt"), text);
writeFileSync(join(scratch, "b.txt"), utf8, "utf8");
rmSync(scratch, { recursive: true, force: true });
rmSync(scratch, { force: true });
const exists: boolean = existsSync(scratch);
const parts = [basename("a/b.ts", ".ts"), extname("b.ts"), relative(here, scratch), String(isAbsolute(here))];

const child = spawnSync("bun", ["--version"], { cwd: here, encoding: "utf8" });
const piped = spawnSync("bun", ["run", "x"], { input: "{}", encoding: "utf-8", maxBuffer: 1 << 20 });
const status: number | null = child.status;
const failed: Error | undefined = piped.error;
const listed: string = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 1 << 20 });
const running = spawn(execPath, ["run", "cron"], { cwd: here, env: { PATH: env["PATH"] ?? "" } });
running.stdout.setEncoding("utf8").on("data", (chunk: string) => chunk.length);
running.on("close", (code: number | null) => code);
const killed: boolean = running.kill();

const digest: string = createHash("sha256").update("body", "utf8").digest("hex");
const digestBytes: Uint8Array = createHash("sha256").update("body").digest();

const server = createServer((request: IncomingMessage, response) => {
  request.setEncoding("utf8").on("data", (chunk: string) => chunk.length);
  request.on("end", () => response.writeHead(200, { "content-type": "application/json" }).end("{}"));
});
server.on("connect", (_request, socket) => {
  const upstream = connect(443, "example.test", () => socket.pipe(upstream));
  upstream.on("error", () => socket.destroy());
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address !== null && typeof address !== "string") void address.port;
  server.closeAllConnections();
  server.close(() => undefined);
});

const addresses = Object.values(networkInterfaces()).flatMap((list) => list ?? []);
const internal: boolean | undefined = addresses[0]?.internal;
const mode: string | undefined = process.env["MODE"] ?? env["MODE"];
const args: readonly string[] = argv.length > 0 ? argv : process.argv;
const cwd: string = process.cwd();
const quit: (code?: number) => never = exit;

export const used = [made, names, bytes, exists, parts, status, failed, listed, killed, digest, digestBytes, internal, mode, args, cwd, quit];
