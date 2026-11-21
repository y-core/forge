// The stubs add no global: each name below must stay undeclared for a Worker program under `"types": []`.
// @ts-expect-error -- no global `process`
void process;
// @ts-expect-error -- no global `Buffer`
void Buffer;
// @ts-expect-error -- no global `Bun`
void Bun;
// @ts-expect-error -- no global `require`
void require;
