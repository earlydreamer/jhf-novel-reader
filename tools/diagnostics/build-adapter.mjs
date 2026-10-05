import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
const directory = resolve('.superpowers/issue48');
await mkdir(directory, { recursive: true });
const bundle = await rolldown({ input: resolve('tools/diagnostics/adapter.ts'), platform: 'node' });
await bundle.write({ file: resolve(directory, 'adapter.mjs'), format: 'esm' });
await bundle.close();
process.stdout.write('Built diagnostic adapter from the current checkout.\n');
