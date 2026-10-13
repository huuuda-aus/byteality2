// Runs the level generator off the main thread (the same code as `npm run levels`), so it works on the deployed site too.
import { generateBatch } from '../tools/levelgen/batch.ts';

interface Job { count: number; seed: number; calibrate: boolean }
self.onmessage = (e: MessageEvent<Job>) => {
  const { count, seed, calibrate } = e.data;
  try {
    const batch = generateBatch({ count, seed, calibrate, onProgress: (made) => (self as unknown as Worker).postMessage({ type: 'progress', made, count }) });
    (self as unknown as Worker).postMessage({ type: 'done', batch });
  } catch (err) { (self as unknown as Worker).postMessage({ type: 'error', message: String((err as Error).message ?? err) }); }
};
