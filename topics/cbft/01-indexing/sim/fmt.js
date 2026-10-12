// Formatting for sizes, durations and counts, shared by the simulator
// (log messages) and the UI.

import { MB } from './config.js';

export function fmtBytes(b) {
  if (b >= 1024 * MB) return (b / 1024 / MB).toFixed(1) + 'GB';
  if (b >= MB) return (b / MB).toFixed(1) + 'MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + 'KB';
  return Math.round(b) + 'B';
}

export function fmtMs(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + 's';
  if (ms >= 1) return ms.toFixed(0) + 'ms';
  return (ms * 1000).toFixed(0) + 'µs';
}

export function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}
