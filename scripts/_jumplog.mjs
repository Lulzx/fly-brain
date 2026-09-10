globalThis.LOG_JUMPS = true;
process.argv = ['node', 'x', 'forage'];
await import('./behavior_report.mjs');
