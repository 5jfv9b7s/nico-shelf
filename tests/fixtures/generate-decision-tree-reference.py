import json,sys
import numpy as np
import sklearn
from sklearn.tree import DecisionTreeClassifier
from sklearn.metrics import confusion_matrix,accuracy_score,balanced_accuracy_score,precision_score,recall_score,f1_score
x=np.arange(48,dtype=float).reshape(-1,1)
y=np.array([int((i<9 or 17<=i<29 or i>=39) != (i in [3,20,43])) for i in range(48)])
probe=np.array([[i/2] for i in range(-2,97)])
cases=[]
for criterion in ['gini','entropy']:
 for alpha in [0,0.01,0.08]:
  model=DecisionTreeClassifier(criterion=criterion,max_depth=4,min_samples_leaf=3,ccp_alpha=alpha,random_state=0).fit(x,y)
  cases.append(dict(criterion=criterion,alpha=alpha,predicted=model.predict(probe).tolist(),scores=model.predict_proba(probe)[:,1].tolist(),leaves=int(model.get_n_leaves()),root_threshold=float(model.tree_.threshold[0])))
actual=[1,1,1,1,0,0,0,0,0,0];predicted=[1,1,0,0,1,0,0,0,0,0]
output=dict(source='scikit-learn '+sklearn.__version__,values=x.tolist(),labels=y.tolist(),probe=probe.tolist(),cases=cases,metrics=dict(actual=actual,predicted=predicted,accuracy=accuracy_score(actual,predicted),balancedAccuracy=balanced_accuracy_score(actual,predicted),precision=precision_score(actual,predicted),recall=recall_score(actual,predicted),f1=f1_score(actual,predicted),matrix=confusion_matrix(actual,predicted).tolist()))
with open('tests/fixtures/decision-tree-reference.json','w') as f:json.dump(output,f,indent=2)
print('Created synthetic reference:',output['source'])
