// Byte-for-byte the import list a Worker app's `src/client/main.ts` writes, because the regression
// this fixture guards is reachable from exactly these four entry points and from nothing else.
import "@y-core/forge/ui/show/client";
import "@y-core/forge/ui/chrome/client";
import { resume } from "@y-core/forge/ui/client";
import { htmx } from "@y-core/forge/ui/client/htmx";

htmx.config.responseHandling.unshift({ code: "422", swap: true });
resume();
