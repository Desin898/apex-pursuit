import numpy as np
from skimage.morphology import skeletonize, binary_closing, disk
d=np.load('/tmp/map/meshes.npz')
V=d['6400_node_1_V']; F=d['6400_node_1_F']
x0,z0=-560,-600; W,H=1250,1300; res=1.0
mask=np.zeros((H,W),bool); hgt=np.full((H,W),np.nan,np.float32)
for f in F:
    p=V[f]; xs=(p[:,0]-x0)/res; zs=(p[:,2]-z0)/res
    i0,i1=int(np.floor(xs.min())),int(np.ceil(xs.max())); j0,j1=int(np.floor(zs.min())),int(np.ceil(zs.max()))
    if i1-i0>200 or j1-j0>200: continue
    I,J=np.meshgrid(np.arange(i0,i1+1),np.arange(j0,j1+1))
    px,pz=I+0.5,J+0.5
    (ax,az),(bx,bz),(cx,cz)=zip(xs,zs)
    den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz)
    if abs(den)<1e-9: continue
    l1=((bz-cz)*(px-cx)+(cx-bx)*(pz-cz))/den; l2=((cz-az)*(px-cx)+(ax-cx)*(pz-cz))/den; l3=1-l1-l2
    ins=(l1>=-1e-6)&(l2>=-1e-6)&(l3>=-1e-6)&(I>=0)&(I<W)&(J>=0)&(J<H)
    y=l1*p[0,1]+l2*p[1,1]+l3*p[2,1]
    mask[J[ins],I[ins]]=True; hgt[J[ins],I[ins]]=y[ins]
mask=binary_closing(mask,disk(2))
np.save('/tmp/h/roadmask.npy',mask); np.save('/tmp/h/roadh.npy',hgt)
from scipy import ndimage
dist=ndimage.distance_transform_edt(mask)
sk=skeletonize(mask)
np.save('/tmp/h/skel.npy',sk); np.save('/tmp/h/dist.npy',dist)
print('road px',mask.sum(),'skel px',sk.sum(),'median half width',np.median(dist[sk]))
from PIL import Image
im=np.zeros((H,W,3),np.uint8); im[mask]=(90,90,90); im[sk]=(255,60,60)
Image.fromarray(im[::-1]).save('/tmp/h/skel.png')
