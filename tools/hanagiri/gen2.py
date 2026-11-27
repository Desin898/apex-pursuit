import numpy as np, json, zlib, base64, math
from scipy import ndimage
from scipy.spatial import cKDTree
S=1.75; H0=57.0
d=np.load('/tmp/h/lapdense.npz'); X,Z,Y=d['X'],d['Z'],d['Y']
n=len(X)
# ── control points every ~20 m ──
s=np.r_[0,np.cumsum(np.hypot(np.diff(X),np.diff(Z)))]; L=s[-1]+math.hypot(X[0]-X[-1],Z[0]-Z[-1])
K=int(round(L/20)); us=np.linspace(0,L,K,endpoint=False)
cx=np.interp(us,s,X); cz=np.interp(us,s,Z); cy=np.interp(us,s,Y)
# start: on the village straight; find the lap point nearest the village centre (houses)
control=np.c_[cx,cz,cy]
# ── port of WorldData.buildTrack (closed Catmull-Rom, SUB 48, 2 m arc-length resample) ──
def build(ctrl,spacing=2.0,SUB=48):
    m=len(ctrl); dense=[]
    t=np.arange(SUB)/SUB; t2=t*t; t3=t2*t
    for i in range(m):
        p0,p1,p2,p3=ctrl[(i-1)%m],ctrl[i],ctrl[(i+1)%m],ctrl[(i+2)%m]
        cr=lambda a,b,c,d_: 0.5*(2*b+(-a+c)*t[:,None]+(2*a-5*b+4*c-d_)*t2[:,None]+(-a+3*b-3*c+d_)*t3[:,None])
        dense.append(cr(p0,p1,p2,p3))
    dense=np.concatenate(dense)
    nxt=np.roll(dense,-1,axis=0)
    seg=np.hypot(nxt[:,0]-dense[:,0],nxt[:,1]-dense[:,1])
    cum=np.r_[0,np.cumsum(seg)]; total=cum[-1]
    cnt=int(round(total/spacing)); step=total/cnt
    dd=np.arange(cnt)*step
    j=np.searchsorted(cum,dd,side='right')-1
    f=(dd-cum[j])/seg[j]
    a=dense[j]; b=nxt[j]
    pts=a+(b-a)*f[:,None]
    return pts,total
pts,total=build(control)
print('track length',round(total),'samples',len(pts))
SX,SZ,SY=pts[:,0],pts[:,1],pts[:,2]
tx=np.roll(SX,-1)-np.roll(SX,1); tz=np.roll(SZ,-1)-np.roll(SZ,1); tl=np.hypot(tx,tz); tx/=tl; tz/=tl
dyds=(np.roll(SY,-1)-np.roll(SY,1))/4.0
np.savez('/tmp/h/samples.npz',SX=SX,SZ=SZ,SY=SY)
# ── terrain base from the source ──
top=np.load('/tmp/h/src_top.npy')   # source grid: x0=-700, z0=-1000, res 2
sx0,sz0,sres=-700,-1000,2.0
valid=top>30
# normalised convolution: a smooth fill of the gaps and of the land beyond the source, no streaks
pad=400
tv=np.pad(np.where(valid,top,0),pad); vv=np.pad(valid.astype(float),pad)
filled=None
for sg in (3,12,40,120):
    num=ndimage.gaussian_filter(tv,sg); den=ndimage.gaussian_filter(vv,sg)
    est=num/np.maximum(den,1e-6)
    filled=est if filled is None else np.where(den>0.25,est,filled) if False else filled
    if sg==3: f3,d3=est,den
    elif sg==12: f12,d12=est,den
    elif sg==40: f40,d40=est,den
    else: f120,d120=est,den
blend=lambda a,b,w: a*w+b*(1-w)
w3=np.clip(d3*2-0.4,0,1); w12=np.clip(d12*2-0.2,0,1); w40=np.clip(d40*3,0,1)
filled=blend(f3,blend(f12,blend(f40,f120,w40),w12),w3)
filled=np.where(np.pad(valid,pad),np.pad(top,pad),filled)
filled=ndimage.gaussian_filter(filled,1.5)
valid=np.pad(valid,pad)
sx0-=pad*sres; sz0-=pad*sres
top=filled
outside=ndimage.distance_transform_edt(~valid)*sres*S   # game metres beyond the source land
outside=ndimage.gaussian_filter(outside,6)
# game grid
CELL=4.0
gx0,gx1=X.min()-480,X.max()+480; gz0,gz1=Z.min()-480,Z.max()+480
NX=int((gx1-gx0)/CELL)+1; NZ=int((gz1-gz0)/CELL)+1
gx=gx0+np.arange(NX)*CELL; gz=gz0+np.arange(NZ)*CELL
GX,GZ=np.meshgrid(gx,gz)
srcx=(GX/S-sx0)/sres-0.5; srcz=(GZ/S-sz0)/sres-0.5
base=ndimage.map_coordinates(top,[srcz,srcx],order=1,mode='nearest')
outd=ndimage.map_coordinates(outside,[srcz,srcx],order=1,mode='nearest')
# outside the grid of the source: distance keeps growing
edge=np.maximum(np.maximum(-srcx,srcx-(top.shape[1]-1)),np.maximum(-srcz,srcz-(top.shape[0]-1)))
outd=np.maximum(outd,np.maximum(edge,0)*sres*S)
T=S*(base-H0)
# value noise
rng=np.random.default_rng(7)
def vnoise(x,z,seed):
    r=np.random.default_rng(seed); tab=r.random((256,256))
    ix=np.floor(x).astype(int); iz=np.floor(z).astype(int); fx=x-ix; fz=z-iz
    ux=fx*fx*(3-2*fx); uz=fz*fz*(3-2*fz)
    a=tab[iz%256,ix%256]; b=tab[iz%256,(ix+1)%256]; c=tab[(iz+1)%256,ix%256]; e=tab[(iz+1)%256,(ix+1)%256]
    return a+(b-a)*ux+(c-a)*uz+(a-b-c+e)*ux*uz
def fbm(x,z,o,seed):
    s_=0; a=0.5; nn=0
    for i in range(o):
        s_+=a*vnoise(x,z,seed+i); nn+=a; x=x*2.03+17.1; z=z*2.03+3.7; a*=0.5
    return s_/nn
def ridged(x,z,o,seed):
    s_=0; a=0.5; nn=0; w=1
    for i in range(o):
        r=1-np.abs(vnoise(x,z,seed+i)*2-1); r=r*r*w; w=np.minimum(1,r*1.6); s_+=a*r; nn+=a
        x=x*2.1+5.3; z=z*2.1+9.2; a*=0.5
    return s_/nn
detail=(fbm(GX/260,GZ/260,4,11)-0.5)*26+(fbm(GX/55,GZ/55,3,31)-0.5)*7
rise=np.clip(outd/1100,0,1); rise=rise*rise*(3-2*rise)
mount=rise*(120+520*ridged(GX/700+3,GZ/700-5,5,51))+np.clip(outd,0,300)*0.12
T=T+detail+mount
# ── carve the road in ──
tree=cKDTree(pts[:,:2])
W0=18.0; W1=50.0
P=np.c_[GX.ravel(),GZ.ravel()]
dist,ii=tree.query(P,k=96,distance_upper_bound=W1)
ns=len(pts)
h=T.ravel().copy()
def roady(i,px,pz):
    along=(px-SX[i])*tx[i]+(pz-SZ[i])*tz[i]
    return SY[i]+along*dyds[i]
def sm(e0,e1,x):
    t=np.clip((x-e0)/(e1-e0),0,1); return t*t*(3-2*t)
has=np.isfinite(dist[:,0])
i1=np.where(has,ii[:,0],0); d1=dist[:,0]
# a second leg: nearest sample far (along the lap) from the first
lapd=np.abs(ii-i1[:,None]); lapd=np.minimum(lapd,ns-lapd)
other=np.isfinite(dist)&(lapd>90)  # >180 m along the lap
d2=np.where(other,dist,np.inf); j2=np.argmin(d2,axis=1); d2m=d2[np.arange(len(d2)),j2]; i2=ii[np.arange(len(d2)),j2]
has2=np.isfinite(d2m)
px,pz=P[:,0],P[:,1]
y2=np.where(has2,roady(np.where(has2,i2,0),px,pz),0)
w2=np.where(has2,1-sm(W0,W1,np.where(has2,d2m,W1)),0)
h=h+(y2-h)*w2
y1=np.where(has,roady(i1,px,pz),0)
w1=np.where(has,1-sm(W0,W1,np.where(has,d1,W1)),0)
h=h+(y1-h)*w1
Hg=h.reshape(T.shape)
print('grid',NX,NZ,'h range',Hg.min().round(1),Hg.max().round(1))
np.savez('/tmp/h/grid.npz',H=Hg,gx0=gx0,gz0=gz0,CELL=CELL)
# ── houses from the source village ──
hs=np.load('/tmp/h/houses.npy')
keep=[]
dl,_=cKDTree(np.c_[X/S,Z/S]).query(hs[:,:2])
for (x,z,w,dd,y0,hh),dd_ in zip(hs,dl):
    if not (5<w<32 and 5<dd<32 and 3<hh<22): continue
    if dd_<16 or dd_>120: continue
    if any(math.hypot(x-k[0],z-k[1])<9 for k in keep): continue
    keep.append([x,z,w,dd])
houses=[[round(x*S,1),round(z*S,1),round(min(w*S*0.75,16),1),round(min(dd*S*0.75,14),1)] for x,z,w,dd in keep]
print('houses',len(houses))
# ── encode ──
hmin=float(np.floor(Hg.min())); q=np.clip(np.round((Hg-hmin)*20),0,65535).astype(np.int32)
delta=np.diff(q,axis=1,prepend=0)
raw=(delta.astype(np.int64)&0xffff).astype('<u2').tobytes()
comp=zlib.compress(raw,9)
b64=base64.b64encode(comp).decode()
print('heightfield bytes',len(raw),'compressed',len(comp),'b64',len(b64))
startXZ=None
ctrl=[round(float(v),2) for v in control.ravel()]
out={'control':ctrl,'houses':houses,'hf':{'x0':round(float(gx0),2),'z0':round(float(gz0),2),'cell':CELL,'nx':NX,'nz':NZ,'base':hmin,'step':0.05,'data':b64}}
json.dump(out,open('/tmp/h/hanagiri.json','w'))
