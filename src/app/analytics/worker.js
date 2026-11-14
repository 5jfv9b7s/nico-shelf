import { runAnalysis } from './engine.js';

// Private library data stays in this browser worker's memory.
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: runAnalysis(data.rows, data.options) });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : '分析を完了できませんでした',
    });
  }
};
