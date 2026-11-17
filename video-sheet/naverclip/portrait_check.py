"""네이버클립 폴더 → 캘린더(psk1397·마웨·오르비 등)에서 날짜+이름 찾아 초상권 판정."""
import re, sys, json, datetime as dt, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import videosheet as V
CALS=['psk1397@gmail.com','schedulemanager05@gmail.com','orbiart01@gmail.com','schedulemanager04@gmail.com']
NEG=re.compile(r'초상권[^\n]{0,15}(금지|비동의|미동의|x|X|안|않|불가|노|no|NO)|초상권\s*(동의)?\s*[:：]?\s*(no|NO|x|X|아니)|sns[^\n]{0,30}(않|안|금지|비동의)')
def parse(title):
    m=re.match(r'(\d{6})[ .]*([가-힣]+)',title)
    return (m.group(1), m.group(2)) if m else (None,None)
def run(path):
    _,cal=V.services(); out=[]
    for line in open(path,encoding='utf-8'):
        if '|' not in line: continue
        fid,title=line.strip().split('|',1)
        ymd,nm=parse(title)
        kind='돌잔치' if ('아기' in title or '맘)' in title) else ('샘플' if '샘플' in title else '본식')
        rec=dict(id=fid,folder=title,date=ymd,name=nm,kind=kind,hits=[])
        if ymd:
            d=dt.date(2000+int(ymd[:2]),int(ymd[2:4]),int(ymd[4:]))
            for cid in CALS:
                for e in cal.events().list(calendarId=cid,singleEvents=True,maxResults=250,timeMin=f'{d}T00:00:00+09:00',timeMax=f'{d+dt.timedelta(1)}T00:00:00+09:00').execute().get('items',[]):
                    t=e.get('summary',''); desc=V.html_text(e.get('description',''))
                    if nm and nm[:3] in t and not re.match(r'\s*(예약변경|예약취소|날짜변경)',t):
                        neg_t='초상권' in t
                        neg_d=[l.strip() for l in desc.splitlines() if NEG.search(l)]
                        rec['hits'].append(dict(cal=cid,title=t,title_flag=neg_t,desc_flag=neg_d[:2]))
        if not rec['hits']: rec['verdict']='캘린더없음'
        elif any(h['title_flag'] for h in rec['hits']): rec['verdict']='초상권금지'
        elif any(h['desc_flag'] for h in rec['hits']): rec['verdict']='예약서확인'
        else: rec['verdict']='OK'
        out.append(rec)
    return out
if __name__=='__main__':
    res=run(sys.argv[1]); json.dump(res,open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
    for r in res:
        print(r['verdict'],'|',r['kind'],'|',r['folder'][:40],'|',' / '.join(h['title'][:60] for h in r['hits'])[:120], '|', ' '.join(sum([h['desc_flag'] for h in r['hits']],[]))[:80])
