import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';

// Dev-only helper: the gallery's "new batch" button calls /__generate, which runs the level generator (tools/levelgen) on this machine.
export default defineConfig({
  plugins: [{
    name: 'levelgen',
    configureServer(server) {
      server.middlewares.use('/__generate', (req, res) => {
        const q = new URL(req.url ?? '', 'http://localhost').searchParams;
        const seed = Math.floor(Number(q.get('seed'))), count = Math.floor(Number(q.get('count'))), calibrate = q.get('calibrate') === 'off' ? ['--calibrate', 'off'] : [];
        res.setHeader('Content-Type', 'application/json');
        if (!(seed >= 0 && seed < 1e9) || !(count >= 1 && count <= 200)) { res.statusCode = 400; res.end('{"ok":false,"log":"bad seed or count"}'); return; }
        const p = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', 'tools/levelgen/generate.ts', '--count', String(count), '--seed', String(seed), ...calibrate], { cwd: server.config.root });
        let log = '';
        p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
        p.on('close', (code) => { res.end(JSON.stringify({ ok: code === 0, log })); });
      });
    },
  }],
});
