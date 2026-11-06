import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const password = process.env.CLEARLINE_BROWSER_PASSWORD;
const directory = process.argv[2] || 'funding-browser-artifacts';
async function sanitize(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await sanitize(file);
    else if (entry.isFile() && ['.md', '.json', '.log', '.txt'].includes(extname(file))) {
      const original = await readFile(file, 'utf8');
      if (password && original.includes(password)) {
        await writeFile(file, original.replaceAll(password, '[DISPOSABLE PASSWORD REDACTED]'));
      }
    }
  }
}
await sanitize(directory);
