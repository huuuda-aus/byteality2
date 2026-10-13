import msgpack,os,re
from PIL import Image
O='game/out'
d=msgpack.unpackb(open('game/game.msgpack','rb').read(),raw=False,strict_map_key=False)
def safe(n): return re.sub(r'[^\w.-]','_',n)
def img(i,path):
    w,h,data,ct=i
    if w==0 or h==0: return
    Image.frombytes('RGBA' if ct=='Rgba' else 'L',(w,h),bytes(data)).save(path)
print('settings',d[7][:8]); print('constants',d[10])
print({k:len(d[i]) for k,i in [('triggers',9),('constants',10),('sprites',11),('sounds',12),('backgrounds',13),('paths',14),('scripts',15),('fonts',16),('timelines',17),('objects',18),('rooms',19),('includes',20)]})
for s in d[15]:
    open(f'{O}/scripts/{safe(s[1])}.gml','w').write(s[2])
for s in d[11]:
    sid,name,origin,frames,masks=s
    for k,f in enumerate(frames): img(f,f'{O}/sprites/{safe(name)}_{k}.png')
with open(f'{O}/sprites/_index.txt','w') as f:
    for s in d[11]: f.write(f'{s[0]} {s[1]} origin={s[2]} frames={len(s[3])} size={s[3][0][:2] if s[3] else None}\n')
for b in d[13]: img(b[2],f'{O}/backgrounds/{safe(b[1])}.png')
for s in d[12]:
    ext=s[3] or '.bin'
    if s[5]: open(f'{O}/sounds/{safe(s[1])}{ext}','wb').write(bytes(s[5]))
with open(f'{O}/sounds/_index.txt','w') as f:
    for s in d[12]: f.write(f'{s[0]} {s[1]} {s[3]} len={len(s[5])} vol={s[7]}\n')
EVT={0:'Create',1:'Destroy',2:'Alarm',3:'Step',4:'Collision',5:'Keyboard',6:'Mouse',7:'Other',8:'Draw',9:'KeyPress',10:'KeyRelease'}
spr={s[0]:s[1] for s in d[11]}; objn={o[0]:o[1] for o in d[18]}
def acts(acts_,ind='  '):
    out=''
    for a in acts_:
        # fields: library_id,action_id,action_kind,has_relative,is_question,has_target,action_type,name,code,params_used,params,target,relative,arguments,negate
        out+=f'{ind}[{a[0]}/{a[1]} {a[7]}] target={a[11]} args={a[13]}\n'
        if a[8].strip(): out+=''.join(ind+'    '+l+'\n' for l in a[8].replace('\r','').split('\n'))
    return out
for o in d[18]:
    oid,name,sp,solid,vis,depth,pers,parent,mask,events=o
    t=f'object {name} id={oid} sprite={spr.get(sp)} solid={solid} visible={vis} depth={depth} persistent={pers} parent={objn.get(parent)}\n'
    for e in events:
        et,en,ac=e
        label=EVT.get(et,et)
        if et==4: en=objn.get(en,en)
        t+=f'\n== {label} {en}\n'+acts(ac)
    open(f'{O}/objects/{safe(name)}.txt','w').write(t)
for tl in d[17]:
    t=''
    for m in tl[2]: t+=f'moment {m[0]}\n'+acts(m[1])
    open(f'{O}/timelines/{safe(tl[1])}.txt','w').write(t)
for r in d[19]:
    open(f'{O}/rooms/{safe(r[1])}.txt','w').write(repr(r)[:200000])
print('rooms',[(r[1],r[3],r[4]) for r in d[19]])
print('room_order',d[22])
