import { stdin } from "bun";

import { evaluateQuery, type QueryData } from "./query";

// A rejection the query left unhandled is the query's, and must not change what this process answers.
process.on("unhandledRejection", () => {});

const decoder = new TextDecoder();
let input = "";
for await (const chunk of stdin.stream()) input += decoder.decode(chunk, { stream: true });
const request = JSON.parse(input) as { code: string; data: QueryData; timeoutMs: number };
process.stdout.write(JSON.stringify(evaluateQuery(request.code, request.data, request.timeoutMs)));
