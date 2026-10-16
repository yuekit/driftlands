// Off-thread world generation.
import workerSrc from 'worker-src';

export function generateWorld(onProgress) {
  const url = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
  const jobs = [
    { type: 'clouds', weight: 0.05 },
    { type: 'island', index: 0, cell: 1.8, lodCell: 4.2, weight: 1 },
    { type: 'island', index: 1, cell: 1.8, lodCell: 4.2, weight: 1 },
    { type: 'island', index: 2, cell: 1.8, lodCell: 4.2, weight: 1 },
  ];
  const prog = jobs.map(() => 0);
  const total = jobs.reduce((a, j) => a + j.weight, 0);
  const report = () => onProgress && onProgress(jobs.reduce((a, j, i) => a + prog[i] * j.weight, 0) / total);
  return Promise.all(jobs.map((job, i) => new Promise((resolve, reject) => {
    const w = new Worker(url);
    w.onmessage = (e) => {
      if (e.data.type === 'progress') { prog[i] = e.data.p; report(); }
      else if (e.data.type === 'done') { prog[i] = 1; report(); w.terminate(); resolve(e.data.result); }
    };
    w.onerror = (err) => reject(err);
    w.postMessage({ ...job, id: i });
  }))).then(([clouds, ...islands]) => ({ clouds, islands }));
}
