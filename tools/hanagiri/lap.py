import numpy as np, pickle
from PIL import Image, ImageDraw
edges,cent=pickle.load(open('/tmp/h/graph.pkl','rb'))
def edge(a,b):
    for e in edges:
        if e[0]==a and e[1]==b: return [tuple(p) for p in e[3]]
        if e[0]==b and e[1]==a: return [tuple(p) for p in e[3]][::-1]
    raise Exception((a,b))
for e in edges: print(e[0],e[1],round(e[2]))
def edgeL(a,b,L):
    for e in edges:
        if abs(e[2]-L)<2:
            p=[tuple(q) for q in e[3]]
            return p if e[0]==a else p[::-1]
seq=[(1,5,2999),(5,3,283),(3,7,351),'link76',(6,9,354),(9,2,448),(2,0,593),'link08',(8,1,550)]
parts=[]
for s in seq:
    if isinstance(s,str): parts.append(s); continue
    parts.append(edgeL(*s))
# check continuity
for i,p in enumerate(parts):
    if isinstance(p,str): continue
    print(i, p[0], p[-1], len(p))
pickle.dump(parts,open('/tmp/h/parts.pkl','wb'))
d=np.load('/tmp/map/meshes.npz')
mask=np.load('/tmp/h/roadmask.npy')
H,W=mask.shape
im=Image.new('RGB',(W,H)); px=im.load()
dr=ImageDraw.Draw(im)
m=np.zeros((H,W,3),np.uint8); m[mask]=(70,70,70); im=Image.fromarray(m); dr=ImageDraw.Draw(im)
cols=[(255,80,80),(80,255,80),(80,160,255),(255,255,0),(255,0,255),(0,255,255),(255,140,0),(200,200,255)]
k=0
for p in parts:
    if isinstance(p,str): continue
    dr.line([(q[1],q[0]) for q in p],fill=cols[k%len(cols)],width=3); dr.text((p[len(p)//2][1],p[len(p)//2][0]),str(k),fill=(255,255,255)); k+=1
for name,col in [('6401_node',(255,150,0)),('1337_node',(255,255,255)),('6402_node',(0,200,0))]:
    V=d[name+'_V']
    for v in V[::3]:
        i=int(v[0]+560); j=int(v[2]+600)
        if 0<=i<W and 0<=j<H: dr.point((i,j),fill=col)
im.save('/tmp/h/lap.png')
