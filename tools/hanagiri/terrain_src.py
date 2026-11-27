# Rasterise the source terrain (6000 snow ground + large 6401 rock pieces) on a 2 m grid in SOURCE coords.
import numpy as np
from scipy import ndimage
from scipy.sparse.csgraph import connected_components
from scipy.sparse import coo_matrix
d=np.load('/tmp/map/meshes.npz')
def comps(V,F):
    n=len(V)
    e=np.concatenate([F[:,[0,1]],F[:,[1,2]]])
    g=coo_matrix((np.ones(len(e)),(e[:,0],e[:,1])),shape=(n,n))
    k,lab=connected_components(g,directed=False)
    return k,lab
x0,z0,res=-700,-1000,2.0
W,H=int(1500/res),int(1900/res)
top=np.full((H,W),-1e9,np.float32)
houses=[]
def raster(V,F):
    for f in F:
        p=V[f]; xs=(p[:,0]-x0)/res; zs=(p[:,2]-z0)/res
        i0,i1=int(np.floor(xs.min())),int(np.ceil(xs.max())); j0,j1=int(np.floor(zs.min())),int(np.ceil(zs.max()))
        i0=max(i0,0); j0=max(j0,0); i1=min(i1,W-1); j1=min(j1,H-1)
        if i1<i0 or j1<j0: continue
        I,J=np.meshgrid(np.arange(i0,i1+1),np.arange(j0,j1+1))
        px,pz=I+0.5,J+0.5
        (ax,bx,cx),(az,bz,cz)=xs,zs
        den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz)
        if abs(den)<1e-9: continue
        l1=((bz-cz)*(px-cx)+(cx-bx)*(pz-cz))/den; l2=((cz-az)*(px-cx)+(ax-cx)*(pz-cz))/den; l3=1-l1-l2
        ins=(l1>=-1e-3)&(l2>=-1e-3)&(l3>=-1e-3)
        y=l1*p[0,1]+l2*p[1,1]+l3*p[2,1]
        jj,ii=J[ins],I[ins]
        np.maximum.at(top,(jj,ii),y[ins])
V=d['6000_node_V']; F=d['6000_node_F']; raster(V,F)
V=d['6401_node_V']; F=d['6401_node_F']
k,lab=comps(V,F)
big=0
for c in range(k):
    vi=np.nonzero(lab==c)[0]
    if len(vi)<3: continue
    mn=V[vi].min(0); mx=V[vi].max(0)
    ext=max(mx[0]-mn[0],mx[2]-mn[2])
    fm=F[np.isin(F[:,0],vi)]
    if ext<40 and (mx[1]-mn[1])<30:
        houses.append([float((mn[0]+mx[0])/2),float((mn[2]+mx[2])/2),float(mx[0]-mn[0]),float(mx[2]-mn[2]),float(mn[1]),float(mx[1]-mn[1])])
        continue
    big+=1; raster(V,fm)
print('6401 comps',k,'big',big,'small(houses)',len(houses))
valid=top>-1e8
print('coverage',valid.mean())
np.save('/tmp/h/src_top.npy',top); np.save('/tmp/h/houses.npy',np.array(houses))
from PIL import Image
t=top.copy(); t[~valid]=np.nan
lo,hi=np.nanmin(t),np.nanmax(t); print('h range',lo,hi)
img=((np.nan_to_num((t-lo)/(hi-lo),nan=0))*255).astype(np.uint8)
Image.fromarray(img).save('/tmp/h/src_top.png')
