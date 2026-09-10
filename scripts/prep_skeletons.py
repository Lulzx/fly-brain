"""Bundle neuroglancer precomputed skeletons into one quantized, downsampled binary for the browser.
Format: header uint32[4] = [N, V, P, version]; float32[6] bbox (min xyz, max xyz);
uint32[N+1] neuronPathOffset; uint32[P+1] pathVertOffset; uint16[3*V] quantized xyz.
Paths are polylines (consecutive vertices connected). Neuron i owns paths [neuronPathOffset[i], neuronPathOffset[i+1])."""
import numpy as np, json, os, sys, time, struct
from collections import defaultdict
OUT='public/data'; SK='data/skeletons'
TARGET=int(sys.argv[1]) if len(sys.argv)>1 else 48      # target vertices per neuron after simplification
meta=json.load(open(f'{OUT}/meta.json')); N=meta['N']
nb=open(f'{OUT}/neurons.bin','rb').read()
body_ids=np.frombuffer(nb,dtype=np.int64,count=N,offset=8)

def read_sk(path):
    b=open(path,'rb').read()
    if len(b)<8: return None
    nv,ne=struct.unpack('<II',b[:8])
    if nv==0: return None
    v=np.frombuffer(b,dtype=np.float32,count=nv*3,offset=8).reshape(nv,3)
    e=np.frombuffer(b,dtype=np.uint32,count=ne*2,offset=8+nv*12).reshape(ne,2)
    return v,e

def paths_from_tree(nv,e):
    """Decompose an undirected tree/forest into polylines by walking from leaves/branch points."""
    adj=[[] for _ in range(nv)]
    for a,b in e: adj[a].append(b); adj[b].append(a)
    deg=np.array([len(a) for a in adj])
    visited_edge=set(); paths=[]
    starts=[i for i in range(nv) if deg[i]!=2]
    if not starts and nv>0: starts=[0]
    for s in starts:
        for nxt in adj[s]:
            if (s,nxt) in visited_edge: continue
            p=[s]; prev,cur=s,nxt
            visited_edge.add((prev,cur)); visited_edge.add((cur,prev))
            while True:
                p.append(cur)
                if deg[cur]!=2: break
                a,b=adj[cur]; nn=a if a!=prev else b
                if (cur,nn) in visited_edge: break
                visited_edge.add((cur,nn)); visited_edge.add((nn,cur))
                prev,cur=cur,nn
            paths.append(p)
    # isolated cycles (rare) get dropped
    return paths

def simplify(paths,v,target):
    total=sum(len(p) for p in paths)
    if total<=target: return paths
    # keep endpoints, subsample interiors proportionally; drop very short paths first if too many
    paths=sorted(paths,key=len,reverse=True)
    if len(paths)*2>target: paths=paths[:max(1,target//2)]
    total=sum(len(p) for p in paths)
    k=max(1,int(np.ceil(total/target)))
    out=[]
    for p in paths:
        if len(p)<=2: out.append(p); continue
        keep=p[0:1]+p[1:-1:k]+p[-1:]
        out.append(keep)
    return out

t=time.time()
neuron_path_off=np.zeros(N+1,dtype=np.uint32)
path_lens=[]; verts=[]
missing=0
for i,bid in enumerate(body_ids):
    fp=f'{SK}/{bid}'
    r=read_sk(fp) if os.path.exists(fp) else None
    if r is None:
        missing+=1; neuron_path_off[i+1]=neuron_path_off[i]; continue
    v,e=r
    ps=paths_from_tree(len(v),e) if len(e) else [[0]]
    ps=simplify(ps,v,TARGET)
    for p in ps:
        path_lens.append(len(p)); verts.append(v[p])
    neuron_path_off[i+1]=neuron_path_off[i]+len(ps)
    if i%10000==0: print(i,len(path_lens),sum(path_lens),f'{time.time()-t:.0f}s',flush=True)
V=np.concatenate(verts) if verts else np.zeros((0,3),np.float32)
lo=V.min(0); hi=V.max(0); span=np.maximum(hi-lo,1)
q=np.clip(np.round((V-lo)/span*65535),0,65535).astype(np.uint16)
path_off=np.zeros(len(path_lens)+1,dtype=np.uint32); path_off[1:]=np.cumsum(path_lens)
with open(f'{OUT}/skeletons_lo.bin','wb') as fh:
    fh.write(np.array([N,len(V),len(path_lens),1],dtype=np.uint32).tobytes())
    fh.write(np.concatenate([lo,hi]).astype(np.float32).tobytes())
    fh.write(neuron_path_off.tobytes()); fh.write(path_off.tobytes()); fh.write(q.tobytes())
print('neurons',N,'missing',missing,'verts',len(V),'paths',len(path_lens),'bbox',lo,hi,f'{time.time()-t:.0f}s')
meta['bbox']=[lo.tolist(),hi.tolist()]; meta['skeletonMissing']=missing
json.dump(meta,open(f'{OUT}/meta.json','w'))
