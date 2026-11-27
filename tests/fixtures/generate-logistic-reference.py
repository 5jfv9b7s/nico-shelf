"""Optional reference generator: NumPy + scikit-learn, not required by npm test.

NICO minimizes mean logloss + lambda/2 ||w||^2 (unpenalized intercept).
scikit-learn's equivalent C is 1/(n*lambda). Population SD uses ddof=0.
"""
import json
import math
from pathlib import Path
import numpy as np
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, log_loss, brier_score_loss

cases = []
for kind in ['mixed', 'separable', 'collinear']:
    raw = np.array([[math.sin(i*0.71)*3 + i/20, (i % 4 == 0)*1.0, math.cos(i*0.43)] for i in range(48)])
    if kind == 'collinear':
        raw[:, 2] = raw[:, 0] * 2
    labels = np.array([int(2*raw[i, 0] + raw[i, 1] > 0) if kind == 'separable' else int((i*7)%13 < 3 + 3*(raw[i, 0] > 0)) for i in range(48)])
    mean, scale = raw.mean(axis=0), raw.std(axis=0)
    values = (raw - mean) / scale
    for strength in [0.0001, 0.01, 1.0]:
        model = LogisticRegression(C=1/(len(labels)*strength), solver='lbfgs', tol=1e-12, max_iter=5000).fit(values, labels)
        probs = model.predict_proba(values)[:, 1]
        cases.append({'name': kind + '-' + str(strength), 'raw': raw.tolist(), 'values': values.tolist(), 'mean': mean.tolist(), 'scale': scale.tolist(), 'labels': labels.tolist(), 'lambda': strength, 'intercept': model.intercept_[0], 'weights': model.coef_[0].tolist(), 'probabilities': probs.tolist(), 'auc': roc_auc_score(labels, probs), 'logLoss': log_loss(labels, probs), 'brier': brier_score_loss(labels, probs)})
result = {'reference': 'scikit-learn ' + sklearn.__version__ + '; NumPy ' + np.__version__, 'objective': 'mean logloss + lambda/2 * ||w||^2; intercept unpenalized; C=1/(n*lambda)', 'cases': cases}
Path(__file__).with_name('logistic-reference.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
