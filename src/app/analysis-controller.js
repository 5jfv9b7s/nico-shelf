import { buildLibraryRows } from './library.js';
import { analysisDefaults, ANALYSIS_METHODS, METRICS } from './analytics/data.js';
import { analysisCsv, ruleSourceCsv, ruleSourceArff } from './analytics/export.js';
import { RULE_FIELDS } from './analytics/rule-data.js';
import { TREE_CATEGORIES } from './analytics/classification-data.js';

export function createAnalysisController({
  root,
  state,
  render,
  createWorker = () =>
    new Worker(new URL('./analytics/worker.js', import.meta.url), {
      type: 'module',
    }),
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
    state.analysis.treeExpansion = {};
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
    const { result, error, selection, busy, ruleBinsOpen, treeExpansion, ...options } =
      state.analysis;
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
      worker.postMessage({
        id,
        rows: buildLibraryRows(state.library),
        options,
      });
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
    if (['analysis-export', 'analysis-source-csv', 'analysis-source-arff'].includes(button.id)) {
      synchronize();
      const result = state.analysis.result;
      if (!result) return render();
      try {
        const arff = button.id === 'analysis-source-arff';
        const source = button.id !== 'analysis-export';
        const content = arff
          ? ruleSourceArff(result)
          : source
            ? ruleSourceCsv(result)
            : analysisCsv(result);
        const url = URL.createObjectURL(
          new Blob([content], {
            type: arff ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8',
          }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download =
          'nico-shelf-' + result.method + (source ? '-source' : '') + (arff ? '.arff' : '.csv');
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        state.analysis.error = error.message || 'ファイルを出力できませんでした';
        render();
      }
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
    if (button.dataset.analysisNode !== undefined) {
      synchronize();
      if (
        !state.analysis.result?.nodes?.some(
          (node) => node.id === Number(button.dataset.analysisNode),
        )
      )
        return render();
      state.analysis.selection = { type: 'node', index: Number(button.dataset.analysisNode) };
      return render();
    }
    if (button.dataset.analysisGroup !== undefined || button.dataset.analysisRule !== undefined) {
      state.analysis.selection =
        button.dataset.analysisGroup !== undefined
          ? { type: 'group', index: Number(button.dataset.analysisGroup) }
          : { type: 'rule', index: Number(button.dataset.analysisRule) };
      return render();
    }
    if (button.dataset.analysisK) {
      const k = Number(button.dataset.analysisK);
      if (Number.isInteger(k) && k >= 2 && k <= 8) {
        state.analysis.k = k;
        return execute();
      }
    }
  });
  root.addEventListener(
    'toggle',
    (event) => {
      if (state.user && event.target.id === 'analysis-rule-bins') {
        state.analysis.ruleBinsOpen = event.target.open;
      }
      if (state.user && event.target.dataset?.analysisTreeBranch !== undefined) {
        state.analysis.treeExpansion[event.target.dataset.analysisTreeBranch] = event.target.open;
      }
    },
    true,
  );
  root.addEventListener('change', (event) => {
    const input = event.target;
    if (!input.dataset.analysisField || !state.user) return;
    const field = input.dataset.analysisField;
    const allowed = [
      'playlist',
      'playlists',
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
      'ruleSort',
      'features',
      'ruleMode',
      'ruleFields',
      'ruleMaxSize',
      'ruleMinCount',
      'ruleMinLift',
      'ruleLimit',
      'ruleConsequentField',
      'ruleConsequentItem',
      'ruleViewBins',
      'ruleYearBins',
      'ruleDurationBins',
      'treeTarget',
      'treePlaylist',
      'treeThreshold',
      'treeCategories',
      'treeDepth',
      'treeMinLeaf',
      'treeAlpha',
      'treeCriterion',
      'treeFolds',
    ];
    if (!allowed.includes(field)) return;
    synchronize();
    clear();
    if (field === 'playlists') {
      const chosen = new Set(state.analysis.playlists);
      const valid = state.library.playlists.some((p) => String(p.id) === input.value);
      if (!input.value) chosen.clear();
      else if (valid) input.checked ? chosen.add(input.value) : chosen.delete(input.value);
      state.analysis.playlists = [...chosen];
      state.analysis.playlist = '';
    } else if (field === 'features' || field === 'ruleFields' || field === 'treeCategories') {
      const chosen = new Set(state.analysis[field]);
      const catalog =
        field === 'features' ? METRICS : field === 'treeCategories' ? TREE_CATEGORIES : RULE_FIELDS;
      if (Object.hasOwn(catalog, input.value))
        input.checked ? chosen.add(input.value) : chosen.delete(input.value);
      state.analysis[field] = [...chosen];
    } else
      state.analysis[field] =
        input.type === 'checkbox'
          ? input.checked
          : [
                'k',
                'support',
                'confidence',
                'ruleMaxSize',
                'ruleMinCount',
                'ruleMinLift',
                'ruleLimit',
                'treeThreshold',
                'treeDepth',
                'treeMinLeaf',
                'treeAlpha',
                'treeFolds',
              ].includes(field)
            ? input.value.trim() === ''
              ? NaN
              : Number(input.value) *
                (['support', 'confidence'].includes(field) &&
                input.dataset.analysisPercent === 'true'
                  ? 0.01
                  : 1)
            : input.value;
    if (
      field === 'ruleFields' &&
      !state.analysis.ruleFields.includes(state.analysis.ruleConsequentField)
    )
      state.analysis.ruleConsequentField = '';
    if (
      [
        'ruleFields',
        'ruleMode',
        'ruleConsequentField',
        'ruleViewBins',
        'ruleYearBins',
        'ruleDurationBins',
        'playlists',
        'playlist',
        'voice',
        'support',
        'ruleMinCount',
      ].includes(field)
    )
      state.analysis.ruleConsequentItem = '';
    render();
  });
  return { synchronize, execute, cancel };
}
