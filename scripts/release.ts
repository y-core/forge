import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "../src/cli/mod";
import { createReleaseCommand } from "../src/pkg/mod";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `CHANGELOG.md` is staged alongside `package.json` so the bump, the promoted changelog and the
// tag are one commit — the whole point of bringing the changelog inside the release transaction.
// The library default stays `["package.json"]`: a changelog is this repository's policy, not
// every consumer's.
await execute(createReleaseCommand({ cwd, stageFiles: ["package.json", "CHANGELOG.md"] }));
