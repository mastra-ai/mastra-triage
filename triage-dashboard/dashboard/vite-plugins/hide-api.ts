import type { Plugin } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const FILES: Record<'issue' | 'pr', string> = {
  issue: path.join(DATA_DIR, 'issues.json'),
  pr: path.join(DATA_DIR, 'pull-requests.json'),
};

export function hideApiPlugin(): Plugin {
  const dataFiles = new Set(Object.values(FILES).map((f) => path.resolve(f)));

  return {
    name: 'hide-api',
    config() {
      return {
        server: {
          watch: {
            ignored: [
              path.join(DATA_DIR, 'issues.json'),
              path.join(DATA_DIR, 'pull-requests.json'),
            ],
          },
        },
      };
    },
    handleHotUpdate(ctx) {
      // Safety net — handleHotUpdate doesn't cover public dir, but cheap.
      if (dataFiles.has(path.resolve(ctx.file))) return [];
    },
    configureServer(server) {
      // Vite watches public/ separately from the module graph and triggers a
      // full-reload on any change. Remove these files from that watcher too.
      server.watcher.unwatch(path.join(DATA_DIR, 'issues.json'));
      server.watcher.unwatch(path.join(DATA_DIR, 'pull-requests.json'));

      server.middlewares.use('/api/hide', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const { kind, number, hidden } = body;
          if (kind !== 'issue' && kind !== 'pr') throw new Error('invalid kind');
          if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
            throw new Error('invalid number');
          }
          if (typeof hidden !== 'boolean') throw new Error('invalid hidden');

          const filePath = FILES[kind as 'issue' | 'pr'];
          const raw = await readFile(filePath, 'utf8');
          const items = JSON.parse(raw) as Array<Record<string, unknown>>;
          const idx = items.findIndex((i) => i.number === number);
          if (idx === -1) throw new Error('item not found');

          if (hidden) items[idx].hidden = true;
          else delete items[idx].hidden;

          await writeFile(filePath, JSON.stringify(items, null, 2));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
        }
      });
    },
  };
}
