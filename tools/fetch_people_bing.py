# -*- coding: utf-8 -*-
"""人物肖像补充：Bing 图片检索，标题必须包含人物名，失败则使用占位图。"""
import hashlib, html, io, json, re, time, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'assets'; IMG=ASSETS/'images'; MAN=IMG/'manifest.json'
GEO=json.loads((ASSETS/'geo.json').read_text(encoding='utf-8'))
manifest=json.loads(MAN.read_text(encoding='utf-8')) if MAN.exists() else {}
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

BAD=['招聘','服务员','游戏','漫画','动画','电视剧','演员','表情包','广告','海报','简笔','卡通','玩偶','手办','cos','壁纸','素材']
def bing(q, name):
    url='https://www.bing.com/images/search?q='+urllib.parse.quote(q)
    try:
        req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Language':'zh-CN,zh;q=0.9'})
        page=urllib.request.urlopen(req,timeout=30).read().decode('utf-8','ignore')
    except Exception as e:
        print(' search fail',name,type(e).__name__,flush=True); return []
    raw=re.findall(r'<a[^>]*class="iusc"[^>]*?m="([^"]+)"',page)
    out=[]
    for s in raw:
        try: d=json.loads(html.unescape(s))
        except: continue
        title=d.get('t') or ''
        if name not in title: continue
        if any(b in title.lower() for b in BAD): continue
        sc=100
        if any(k in title for k in ['画像','肖像','像']): sc+=25
        if any(k in title for k in ['照片','摄影']): sc+=10
        d['_sc']=sc; out.append(d)
    out.sort(key=lambda x:-x.get('_sc',0))
    return out

def save(item,key):
    for u in [item.get('murl'),item.get('turl')]:
        if not u: continue
        try:
            req=urllib.request.Request(u,headers={'User-Agent':UA,'Referer':item.get('purl','')})
            data=urllib.request.urlopen(req,timeout=25).read()
            im=Image.open(io.BytesIO(data)); im.load()
        except Exception: continue
        if im.width<280 or im.height<200: continue
        im=im.convert('RGB')
        if im.width>900: im=im.resize((900,round(im.height*900/im.width)),Image.LANCZOS)
        name=hashlib.md5(key.encode()).hexdigest()[:12]+'_0.webp'
        im.save(IMG/name,'WEBP',quality=80,method=4)
        purl=item.get('purl','')
        credit='公开网络资料'
        if 'wikimedia' in purl or 'wikipedia' in purl: credit='Wikimedia Commons'
        elif 'baike.baidu.com' in purl: credit='百度百科（公开页面）'
        return {'file':name,'caption':item.get('t',''),'credit':credit,'license':'版权归原作者','source':purl,'original':u}
    return None

seen=set(); people=[]
for era in GEO['eras']:
    for p in era['people']:
        if p['name'] in seen: continue
        seen.add(p['name']); people.append((p,era))
for n,(p,era) in enumerate(people,1):
    key='person:'+p['name']
    old=manifest.get(key,[])
    for im in old:
        try: (IMG/im['file']).unlink(missing_ok=True)
        except: pass
    modern=bool(re.search(r'18[0-9]{2}|19[0-9]{2}',p.get('life','')) and '前' not in p.get('life',''))
    q=p['name']+' '+era['name']+(' 照片' if modern else ' 画像')
    found=bing(q,p['name'])
    img=None
    for item in found[:5]:
        img=save(item,key)
        if img: break
    if img:
        manifest[key]=[img]
        print(f'[{n}/{len(people)}] {p["name"]} OK',flush=True)
    else:
        manifest.pop(key,None)
        print(f'[{n}/{len(people)}] {p["name"]} -- no portrait',flush=True)
    MAN.write_text(json.dumps(manifest,ensure_ascii=False,indent=1),encoding='utf-8')
    time.sleep(0.2)
print('done people',len(people),'with images',sum(1 for p,_ in people if manifest.get('person:'+p['name'])),flush=True)
