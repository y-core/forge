import { execute } from "../../cli/mod";
import { createAssetsCommands } from "./commands";

const root = createAssetsCommands();
await execute(root);
