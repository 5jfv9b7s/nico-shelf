import { buildLibraryRows } from './library.js';
import { analysisDefaults, ANALYSIS_METHODS, METRICS } from './analytics/data.js';
import { analysisCsv } from './analytics/export.js';

export function createAnalysisController({
  root,
  state,
  render,
  createWorker = () =>
    new Worker(new URL('./analytics/worker.js', import.meta.url), { type: 'module' }),
}) {
  let worker = null,
    generation = 0,
    owner = state.user?.id,
    library = state.library;
  function cancel() {
    generation++;
    worker?.terminate();
    worker = null;
    state.analysis.busy = false;
  }
  function clear() {
    cancel();
    state.analysis.result = null;
    state.analysis.error = '';
    state.analysis.selection = null;
  }
  function synchronize() {
    if (owner !== state.user?.id) {
      clear();
      state.analysis = analysisDefaults();
      owner = state.user?.id;
      library = state.library;
    } else if (library !== state.library) {
      clear();
      library = state.library;
    }
  }
  function execute() {
    synchronize();
    if (!state.user) return;
    clear();
    state.analysis.busy = true;
    const id = generation,
      userId = state.user.id;
    const { result, error, selection, busy, ...options } = state.analysis;
    try {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        if (data.id !== generation || state.user?.id !== userId || state.library !== library)
          return;
        state.analysis.busy = false;
        state.analysis.result = data.result || null;
        state.analysis.error = data.error || '';
        worker?.terminate();
        worker = null;
        if (state.view === 'analysis') render();
      };
      worker.onerror = () => {
        if (id !== generation || state.user?.id !== userId) return;
        cancel();
        state.analysis.error = '分析を開始できませんでした。再読み込みして試してください。';
        if (state.view === 'analysis') render();
      };
      worker.postMessage({ id, rows: buildLibraryRows(state.library), options });
    } catch {
      cancel();
      state.analysis.error =
        'この環境では分析用の処理を開始できません。ブラウザを更新して試してください。';
    }
    render();
  }
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !state.user) return;
    if (button.id === 'analysis-run') return execute();
    if (button.id === 'analysis-cancel') {
      cancel();
      return render();
    }
    if (button.id === 'analysis-export' && state.analysis.result) {
      const url = URL.createObjectURL(
        new Blob([analysisCsv(state.analysis.result)], { type: 'text/csv;charset=utf-8' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nico-shelf-' + state.analysis.method + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (
      button.dataset.analysisMethod &&
      Object.hasOwn(ANALYSIS_METHODS, button.dataset.analysisMethod)
    ) {
      clear();
      state.analysis.method = button.dataset.analysisMethod;
      return render();
    }
    if (button.dataset.analysisGroup !== undefined || button.dataset.analysisRule !== undefined) {
      state.analysis.selection =
        button.dataset.analysisGroup !== undefined
          ? { type: 'group', index: Number(button.dataset.analysisGroup) }
          : { type: 'rule', index: Number(button.dataset.analysisRule) };
      return render();
    }
  });
  root.addEventListener('change', (event) => {
    const input = event.target;
    if (!input.dataset.analysisField || !state.user) return;
    const field = input.dataset.analysisField;
    const allowed = [
      'playlist',
      'voice',
      'x',
      'y',
      'logCounts',
      'correlation',
      'clusterMethod',
      'k',
      'support',
      'confidence',
      'ruleExtras',
      'features',
    ];
    if (!allowed.includes(field)) return;
    clear();
    if (field === 'features') {
      const chosen = new Set(state.analysis.features);
      if (METRICS[input.value])
        input.checked ? chosen.add(input.value) : chosen.delete(input.value);
      state.analysis.features = [...chosen];
    } else
      state.analysis[field] =
        input.type === 'checkbox'
          ? input.checked
          : ['k', 'support', 'confidence'].includes(field)
            ? Number(input.value)
            : input.value;
    render();
  });
  return { synchronize, execute, cancel };
}
