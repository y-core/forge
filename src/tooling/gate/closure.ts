import { dirname, resolve } from "node:path";

import { importClosure } from "../assets/closure";
import { loadWranglerConfig } from "../cf/config/parse";

/** The import closure, relative to `root`, of the `main` the Worker config at `workerConfig` names; rejects when it names none. @public */
export async function workerMainClosure(root: string, workerConfig: string): Promise<string[]> {
  const loaded = loadWranglerConfig(resolve(root, workerConfig));
  const main = loaded.config.main;
  if (typeof main !== "string" || main === "") throw new Error(`${workerConfig} names no \`main\` to trace`);
  return importClosure(root, [`./${main.replace(/^\.\//, "")}`], dirname(resolve(root, workerConfig)));
}
