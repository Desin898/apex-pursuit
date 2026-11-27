import numpy as np, pickle, json, zlib, base64, math
from scipy import ndimage
from scipy.spatial import cKDTree
SIG=7.0
S=1.75          # horizontal and vertical scale (source → game)
H0=57.0         # source height of the village straight → game y = 0
parts=pickle.load(open('/tmp/h/parts.pkl','rb'))
hgt=np.load('/tmp/h/roadh.npy')
m=~np.isnan(hgt); idx=ndimage.distance_transform_edt(~m,return_distances=False,return_indices=True)
roadh=ndimage.uniform_filter(hgt[tuple(idx)],9)

def arr(p): return np.array(p,float)  # (row, col)
def dirn(a,k=25,start=True):
    if start: v=a[min(k,len(a)-1)]-a[0]
    else: v=a[-1]-a[-1-min(k,len(a)-1)]
    return v/np.linalg.norm(v)
def hermite(P0,T0,P1,T1,n):
    t=np.linspace(0,1,n)[:,None]
    h00=2*t**3-3*t**2+1; h10=t**3-2*t**2+t; h01=-2*t**3+3*t**2; h11=t**3-t**2
    return h00*P0+h10*T0+h01*P1+h11*T1
segs=[]
P=[arr(p) if not isinstance(p,str) else p for p in parts]
for i,p in enumerate(P):
    if isinstance(p,str):
        a=P[i-1]; b=P[i+1]
        E1,E2=a[-1],b[0]; d1=dirn(a,start=False); d2=dirn(b,start=True)
        if p=='link76':   # a hairpin round the east end of the valley
            way=None
            c=hermite(E1,d1*80,E2,d2*80,160)
        else:             # a long sweeping turn out to the west and back
            way=[E1-d1*40, E1, E1+d1*70, np.array([1110.,-62.]), np.array([1005.,-58.]), E2-d2*80, E2, E2+d2*40]
        if way is not None:
          c=[]
          for k in range(1,len(way)-2):
            p0,p1,p2,p3=way[k-1],way[k],way[k+1],way[k+2]
            nseg=int(np.linalg.norm(p2-p1))+2
            for t in np.linspace(0,1,nseg,endpoint=False):
                t2,t3=t*t,t*t*t
                c.append(0.5*(2*p1+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3))
          c=np.array(c+[E2])
        segs.append(('link',c[1:-1]))
    else: segs.append(('road',p))
pts=np.concatenate([s[1] for s in segs])
bounds=np.cumsum([len(s[1]) for s in segs])[:-1]  # indices where segments meet
# heights: road raster where on a real road, linear across links
hs=[]
for kind,s in segs:
    if kind=='road':
        r=np.clip(s[:,0].astype(int),0,roadh.shape[0]-1); c=np.clip(s[:,1].astype(int),0,roadh.shape[1]-1)
        hs.append(roadh[r,c])
    else: hs.append(None)
for i,(kind,s) in enumerate(segs):
    if kind=='link':
        a=hs[i-1][-1]; b=hs[i+1][0]; t=np.linspace(0,1,len(s))
        hs[i]=a+(b-a)*t + 6*np.sin(np.pi*t)   # a gentle crest on the new valley roads
H=np.concatenate(hs)
# arc-length resample at 1 m (source), smooth
d=np.r_[0,np.cumsum(np.hypot(*np.diff(pts,axis=0).T))]
L=d[-1]; n=int(L)
u=np.linspace(0,L,n,endpoint=False)
R=np.interp(u,d,pts[:,0]); C=np.interp(u,d,pts[:,1]); Hh=np.interp(u,d,H)
def gsm(a,s): return ndimage.gaussian_filter1d(a,s,mode='wrap')
# where two pieces meet (old junctions) the skeleton jogs: smooth those stretches harder
bd=np.interp(bounds,np.arange(len(d)),d)
R0=gsm(R,SIG); C0=gsm(C,SIG); R1=gsm(R,22); C1=gsm(C,22)
w=np.zeros(n)
for b in list(bd)+[0.0]:
    dist=np.minimum(np.abs(u-b),L-np.abs(u-b))
    w=np.maximum(w,np.clip(1.6-dist/45,0,1))
R=R0*(1-w)+R1*w; C=C0*(1-w)+C1*w
Hh=gsm(Hh,22)
# game coords: x = S*(col-560), z = S*(row-600)
X=S*(C-560); Z=S*(R-600); Y=S*(Hh-H0)
print('lap length (game m)', round(np.sum(np.hypot(np.diff(X),np.diff(Z)))+np.hypot(X[0]-X[-1],Z[0]-Z[-1])))
np.savez('/tmp/h/lapdense.npz',X=X,Z=Z,Y=Y)
