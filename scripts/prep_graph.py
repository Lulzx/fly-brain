"""Build compact browser-ready neuron table + CSR connectivity from the male CNS flat connectome."""
import pyarrow.feather as f, numpy as np, pandas as pd, json, struct, sys, time
RAW='data/raw'; OUT='public/data'
MIN_W=int(sys.argv[1]) if len(sys.argv)>1 else 3

t=time.time()
ann=f.read_feather(f'{RAW}/body-annotations-male-cns-v1.0-minconf-0.5.feather')
ann=ann[ann.status=='Traced'].reset_index(drop=True)
print('traced neurons',len(ann))
nt=f.read_feather(f'{RAW}/body-neurotransmitters-male-cns-v1.0.feather')[['body','consensus_nt','predicted_nt_confidence']]
ann=ann.merge(nt,left_on='bodyId',right_on='body',how='left')

NTS=['unknown','acetylcholine','gaba','glutamate','dopamine','serotonin','octopamine','histamine']
nt_map={n:i for i,n in enumerate(NTS)}
ann['nt_id']=ann.consensus_nt.map(lambda s: nt_map.get(s,0) if isinstance(s,str) else 0).astype(np.uint8)
sc=ann.superclass.fillna('unknown')
SUPERCLASSES=sorted(sc.unique().tolist())
sc_map={s:i for i,s in enumerate(SUPERCLASSES)}
ann['sc_id']=sc.map(sc_map).astype(np.uint8)
cls=ann['class'].fillna('')
CLASSES=sorted(cls.unique().tolist())
cls_map={s:i for i,s in enumerate(CLASSES)}
ann['cls_id']=cls.map(cls_map).astype(np.uint16)
side=ann.somaSide.fillna('?').map({'L':1,'R':2,'M':3}).fillna(0).astype(np.uint8)
soma=np.array([s if isinstance(s,(list,np.ndarray)) and len(s)==3 else [np.nan]*3 for s in ann.somaLocation],dtype=np.float32)
print('soma known',np.isfinite(soma[:,0]).sum())

body_ids=ann.bodyId.to_numpy().astype(np.int64)
idx=pd.Series(np.arange(len(body_ids),dtype=np.int32),index=body_ids)

# connectivity
tbl=f.read_table(f'{RAW}/connectome-weights-male-cns-v1.0-minconf-0.5.feather')
pre=tbl.column('body_pre').to_numpy(); post=tbl.column('body_post').to_numpy(); w=tbl.column('weight').to_numpy()
m=w>=MIN_W
pre,post,w=pre[m],post[m],w[m]
pi=idx.reindex(pre).to_numpy(); qi=idx.reindex(post).to_numpy()
m=np.isfinite(pi)&np.isfinite(qi)
pi=pi[m].astype(np.int32); qi=qi[m].astype(np.int32); w=w[m]
print('edges kept',len(w),'sum syn',int(w.sum()))
order=np.lexsort((qi,pi)); pi,qi,w=pi[order],qi[order],w[order]
N=len(body_ids)
indptr=np.zeros(N+1,dtype=np.uint32); np.add.at(indptr,pi+1,1); indptr=np.cumsum(indptr).astype(np.uint32)
wq=np.minimum(w,65535).astype(np.uint16)
outdeg=np.diff(indptr); indeg=np.bincount(qi,minlength=N)
print('max outdeg',outdeg.max(),'max indeg',indeg.max(), time.time()-t)

# write binaries
def write(path,arrs):
    with open(path,'wb') as fh:
        for a in arrs: fh.write(np.ascontiguousarray(a).tobytes())
write(f'{OUT}/graph_w{MIN_W}.bin',[np.array([N,len(w)],dtype=np.uint32),indptr,qi,wq])
write(f'{OUT}/neurons.bin',[np.array([N,0],dtype=np.uint32),body_ids,soma,indeg.astype(np.uint32),outdeg.astype(np.uint32),ann.cls_id.to_numpy(),ann.nt_id.to_numpy(),ann.sc_id.to_numpy(),side.to_numpy()])
meta={'N':N,'minWeight':MIN_W,'edges':int(len(w)),'nts':NTS,'superclasses':SUPERCLASSES,'classes':CLASSES,
      'types':ann.type.fillna('').tolist(),'instances':ann.instance.fillna('').tolist()}
json.dump(meta,open(f'{OUT}/meta.json','w'))
print('done',time.time()-t)
