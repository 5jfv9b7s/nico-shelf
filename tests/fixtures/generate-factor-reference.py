"""Optional reference generation. Requires NumPy and scikit-learn, not npm test.
Population-standardized features, maximum likelihood, LAPACK SVD, no Kaiser normalization.
Column order/signs are normalized solely for comparing equivalent factor orientations.
"""
import json
from pathlib import Path
import numpy as np
import sklearn
from sklearn.decomposition import FactorAnalysis

result={'reference':'scikit-learn '+sklearn.__version__+'; NumPy '+np.__version__, 'datasets':[]}
for seed,p,k in [(815,5,1),(922,6,2),(2027,9,3)]:
    rng=np.random.default_rng(seed)
    n=180
    truth=np.zeros((p,k))
    for i in range(p):
        truth[i,i%k]=.7+.12*(i%3)
        truth[i,(i+1)%k]+=.13
    raw=rng.normal(size=(n,k))@truth.T+rng.normal(size=(n,p))*.65
    raw=raw*np.arange(1,p+1)+np.arange(p)*11
    mean,scale=raw.mean(axis=0),raw.std(axis=0,ddof=0)
    z=(raw-mean)/scale
    entry={'name':str(seed),'raw':raw.tolist(),'mean':mean.tolist(),'scale':scale.tolist(),'correlation':np.corrcoef(raw.T).tolist(),'cases':[]}
    for rotation in [None,'varimax']:
        model=FactorAnalysis(n_components=k,rotation=rotation,svd_method='lapack',tol=n*1e-6,max_iter=500).fit(z)
        loadings=model.components_.T
        order=np.argsort(-np.sum(loadings**2,axis=0),kind='stable')
        loadings=loadings[:,order]
        signs=np.array([1 if loadings[np.argmax(np.abs(loadings[:,j])),j]>=0 else -1 for j in range(k)])
        loadings=loadings*signs
        scores=model.transform(z)[:,order]*signs
        entry['cases'].append({'count':k,'rotation':rotation or 'none','iterations':model.n_iter_,'loadings':loadings.tolist(),'noise':model.noise_variance_.tolist(),'communalities':np.sum(loadings**2,axis=1).tolist(),'covariance':model.get_covariance().tolist(),'scores':scores.tolist(),'logLikelihood':model.loglike_[-1]/n})
    result['datasets'].append(entry)
Path(__file__).with_name('factor-reference.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
