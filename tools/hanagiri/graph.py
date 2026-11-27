import numpy as np, itertools, json
sk=np.load('/tmp/h/skel.npy'); H,W=sk.shape
pts=set(zip(*np.nonzero(sk)))
def nb(p):
    j,i=p
    return [(j+dj,i+di) for dj in (-1,0,1) for di in (-1,0,1) if (dj or di) and (j+dj,i+di) in pts]
deg={p:len(nb(p)) for p in pts}
nodes=[p for p in pts if deg[p]!=2]
# cluster nearby node pixels
cl={}; cid=0
for p in nodes:
    if p in cl: continue
    st=[p]; cl[p]=cid
    while st:
        q=st.pop()
        for r in nb(q):
            if r in cl or deg[r]==2: continue
            cl[r]=cid; st.append(r)
    cid+=1
edges=[]; seen=set()
for p in nodes:
    for q in nb(p):
        if deg[q]!=2 or (p,q) in seen: continue
        path=[p,q]; prev,cur=p,q
        while deg[cur]==2:
            nx=[r for r in nb(cur) if r!=prev]
            if not nx: break
            # prefer non-diagonal continuity
            prev,cur=cur,nx[0]; path.append(cur)
        seen.add((path[-2],path[-1])); seen.add((q,p))
        a,b=cl[p],cl.get(cur,-1)
        L=sum(np.hypot(path[k+1][0]-path[k][0],path[k+1][1]-path[k][1]) for k in range(len(path)-1))
        edges.append((a,b,L,path))
# dedupe edges (each found twice)
uniq={}
for a,b,L,path in edges:
    k=(min(a,b),max(a,b),round(L))
    uniq[k]=(a,b,L,path)
edges=list(uniq.values())
cent={c:np.mean([p for p in nodes if cl[p]==c],0) for c in range(cid)}
for e in edges: print(e[0],e[1],round(e[2]), 'from',cent[e[0]].round(), 'to', cent.get(e[1],np.array([0,0])).round())
import pickle; pickle.dump((edges,cent),open('/tmp/h/graph.pkl','wb'))
