"""Nicht-normative Referenzimplementierung von allocation.md (Abschnitte 3-6) für die Soll-Pläne.
Aufruf:  python3 allocate_reference.py ../../../contracts/golden-plans   -> prüft alle G*.json
Nur Standardbibliothek. Die produktive Implementierung ist TypeScript (packages/engine)."""
import json, math, sys, pathlib

SORT_DEFAULT = ["setting_soonest","constrained","most_remaining","most_moon_limited",
                "lowest_peak_altitude","due_soonest","mosaic_grouping","card_order"]

def ranges_to_mask(ranges, S):
    m=[False]*S
    for a,b in ranges:
        for t in range(a,b+1):
            if 0<=t<S: m[t]=True
    return m

class Line:
    def __init__(self, d, S, slotS, downloadS):
        self.id=d["id"]; self.filter=d.get("filter",""); self.exp=d.get("exposureS",slotS)
        self.remaining=d["remaining"]; self.planned=d.get("planned",self.remaining)
        self.bonus=d.get("bonus",0); self.mask=ranges_to_mask(d["eligibleSlots"],S)
        self.sep=d.get("moonSeparationDeg",0); self.order=d.get("order",0)
        self.dl=downloadS; self.slotS=slotS
    def need_slots(self, count=None):
        c=self.remaining if count is None else count
        return math.ceil(c*(self.exp+self.dl)/self.slotS)

class Unit:
    def __init__(self, d, S, g):
        self.id=d["id"]; self.priority=d.get("priority",1000)
        self.minSlots=d.get("minTimeSlots",1); self.due=d.get("dueDate")
        self.peak=d.get("peakAltitudeDeg",90); self.project=d.get("projectId",self.id)
        self.lines=[Line(x,S,g["slotS"],g.get("downloadS",0)) for x in d["lines"]]
        self.covered=False   # Hauptbedarf vollständig zugeteilt → Bonus-Durchlauf darf Zeilen nutzen
    def need(self, bonus=False, g=None):
        if not bonus: return sum(l.need_slots() for l in self.lines if l.remaining>0)
        pct=g["bonus"]["overshootPct"]
        tot=0
        for l in self.lines:
            if l.remaining==0 or self.covered:
                room=math.floor(l.planned*pct/100)-l.bonus
                if room>0: tot+=l.need_slots(room)
        return tot
    def elig(self, t, bonus=False):
        if bonus:
            return any(l.mask[t] for l in self.lines if (l.remaining==0 or self.covered))
        return any(l.mask[t] for l in self.lines if l.remaining>0)

def allocate(g):
    S=g["slots"]; strategy=g.get("strategy","proportional"); chain=g.get("sortChain",SORT_DEFAULT)
    reserved=set()
    for r in g.get("reserved",[]):
        reserved.update(range(r["fromSlot"], r["toSlot"]+1))
    units=[Unit(u,S,g) for u in g["units"]]
    assigned=[None]*S
    blocks=[]; diag={}
    def free(t): return t not in reserved and assigned[t] is None
    def eligu(u,t,bonus): return free(t) and u.elig(t,bonus)
    def run(u,t,bonus):
        n=0
        while t+n<S and eligu(u,t+n,bonus): n+=1
        return n
    def rest(u,t,bonus): return sum(1 for x in range(t,S) if eligu(u,x,bonus))
    def runs(u,bonus):
        out=[];t=0
        while t<S:
            if eligu(u,t,bonus):
                n=run(u,t,bonus); out.append(n); t+=n
            else: t+=1
        return out
    def lastslot(u):
        ts=[t for t in range(S) if u.elig(t,False)]; return max(ts) if ts else -1
    def keyfor(u,t,bonus,prev):
        k=[]
        for c in chain:
            if c=="setting_soonest": k.append(lastslot(u))
            elif c=="constrained": k.append(rest(u,t,bonus))
            elif c=="most_remaining": k.append(-u.need(bonus,g))
            elif c=="most_moon_limited":
                total=sum(1 for x in range(S) if u.elig(x,bonus))
                k.append(-sum(l.need_slots() for l in u.lines if l.remaining>0 and sum(l.mask)<total))
            elif c=="lowest_peak_altitude": k.append(u.peak)
            elif c=="due_soonest": k.append(u.due or "9999-12-31")
            elif c=="mosaic_grouping": k.append(0 if prev is not None and prev.project==u.project else 1)
            elif c=="card_order": k.append(u.priority)
        k.append(u.id); return k
    def passrun(bonus):
        need={u.id:u.need(bonus,g) for u in units}
        cap={}
        for u in units:
            cap[u.id]=sum(r for r in runs(u,bonus) if r>=u.minSlots or need[u.id]<=r)
        d={u.id:0 for u in units}
        if strategy=="proportional":
            F=sum(1 for t in range(S) if free(t) and any(u.elig(t,bonus) and cap[u.id]>0 for u in units))
            A=[u for u in units if need[u.id]>0 and cap[u.id]>0]
            R=float(F); x={}
            while A:
                W=sum(need[u.id] for u in A)
                x={u.id:R*need[u.id]/W for u in A}
                B=[u for u in A if min(need[u.id],cap[u.id])<=x[u.id]+1e-12]
                if not B:
                    for u in A: d[u.id]=x[u.id]
                    break
                for u in B:
                    d[u.id]=min(need[u.id],cap[u.id]); R-=d[u.id]
                A=[u for u in A if u not in B]
            Fp=min(F, sum(min(need[u.id],cap[u.id]) for u in units if cap[u.id]>0))
            fl={k:math.floor(v+1e-9) for k,v in d.items()}
            r=Fp-sum(fl.values())
            fr=sorted([u for u in units if d[u.id]-fl[u.id]>1e-9],
                      key=lambda u:(-(d[u.id]-fl[u.id]), keyfor(u,0,bonus,None)))
            for u in fr[:max(0,int(round(r)))]: fl[u.id]+=1
            d=fl
        else:
            d=dict(need)
        a={u.id:0 for u in units}; t=0; prev=None
        while t<S:
            if not free(t): t+=1; continue
            K=[u for u in units if need[u.id]-a[u.id]>0 and eligu(u,t,bonus)
               and (run(u,t,bonus)>=u.minSlots or need[u.id]-a[u.id]<=run(u,t,bonus))]
            overflow=False
            if strategy=="proportional":
                K1=[u for u in K if d[u.id]-a[u.id]>0]
                if not K1: K1=K; overflow=True
            else: K1=K
            if not K1: t+=1; continue
            def dd(u): return need[u.id] if (overflow or strategy!="proportional") else d[u.id]
            if strategy=="proportional":
                us=min(K1,key=lambda u:(rest(u,t,bonus)-(dd(u)-a[u.id]), keyfor(u,t,bonus,prev)))
            else:
                us=min(K1,key=lambda u:(u.priority, keyfor(u,t,bonus,prev)))
            L=min(run(us,t,bonus), need[us.id]-a[us.id])
            if strategy=="proportional": L=min(L, dd(us)-a[us.id])
            if L<us.minSlots and need[us.id]-a[us.id]>L: L=min(us.minSlots, run(us,t,bonus))
            e=t+L; gap=0
            while e+gap<S and free(e+gap) and any(u.elig(e+gap,bonus) for u in units): gap+=1
            others=[v.minSlots for v in units if v is not us and need[v.id]-a[v.id]>0]
            mn=min(others) if others else math.inf
            if 0<gap<mn and all(us.elig(x,bonus) for x in range(e,e+gap)) and need[us.id]-a[us.id]-L>=gap:
                L+=gap
            for x in range(t,t+L): assigned[x]=(us.id,bonus)
            blocks.append({"unit":us.id,"fromSlot":t,"toSlot":t+L-1,"bonus":bonus})
            a[us.id]+=L; t+=L; prev=us
        return need,a,cap
    need,a,cap=passrun(False)
    for u in units:
        if need[u.id]>0 and a[u.id]==0:
            anyelig=any(u.elig(t,False) and t not in reserved for t in range(S))
            diag[u.id]="not_visible" if not anyelig else ("below_min_time" if cap[u.id]==0 else "outranked")
    if g.get("bonus",{}).get("enabled"):
        for u in units: u.covered = need[u.id]>0 and a[u.id]>=need[u.id] or need[u.id]==0
        passrun(True)
    # merge
    blocks.sort(key=lambda b:b["fromSlot"]); merged=[]
    for b in blocks:
        if merged and merged[-1]["unit"]==b["unit"] and merged[-1]["toSlot"]+1==b["fromSlot"]:
            merged[-1]["toSlot"]=b["toSlot"]
        else: merged.append({"unit":b["unit"],"fromSlot":b["fromSlot"],"toSlot":b["toSlot"]})
    for r in g.get("reserved",[]):
        merged.append({"unit":r["observationId"],"fromSlot":r["fromSlot"],"toSlot":r["toSlot"],"transit":True})
    merged.sort(key=lambda b:b["fromSlot"])
    return merged, diag, units, assigned

def entries(g, units, assigned):
    """Einträge vereinfacht für Soll-Pläne: Slot = eine Belichtung (exposureS == slotS, downloadS 0)
    bzw. Sekundenmodell mit Flip (G11)."""
    S=g["slots"]; slotS=g["slotS"]; out=[]
    fs=g.get("filterSwitch",{"enabled":False}); flip=g.get("meridianFlip")
    byid={u.id:u for u in units}
    # Sekundenmodell je Block
    t=0
    while t<S:
        if not assigned[t]: t+=1; continue
        uid,_=assigned[t]; u=byid[uid]; start=t
        while t<S and assigned[t] and assigned[t][0]==uid: t+=1
        blockStart=start*slotS; blockEnd=t*slotS; cursor=blockStart
        rr=0; stackLeft=0; cur=None; flipPending=bool(flip); 
        lines=sorted(u.lines,key=lambda l:l.order)
        restr=sorted(u.lines,key=lambda l:(sum(l.mask), -l.sep, l.order))
        while cursor<blockEnd:
            if flipPending:
                tM=flip["meridianAtS"]; after=tM+flip["afterMin"]*60; mx=tM+flip["maxAfterMin"]*60
                if cursor>=after:
                    out.append({"atS":cursor,"cmd":"meridian_flip","durationS":flip["durationS"]})
                    cursor+=flip["durationS"]; flipPending=False; continue
            def ok(l,c):
                s0=c//slotS; s1=(c+l.exp-1)//slotS
                return c+l.exp<=blockEnd and all(0<=x<S and l.mask[x] for x in range(s0,s1+1))
            pick=None; bonus=False
            main=[l for l in lines if l.remaining>0]
            if fs.get("enabled"):
                if cur is not None and stackLeft>0 and cur.remaining>0 and ok(cur,cursor): pick=cur
                else:
                    n=len(lines)
                    for i in range(n):
                        l=lines[(rr+i)%n]
                        need=math.ceil(fs["every"]*fs.get("tolerancePct",50)/100)
                        if l.remaining>0 and ok(l,cursor) and (blockEnd-cursor)//(l.exp)>=min(need,l.remaining):
                            pick=l; rr=(rr+i+1)%n; stackLeft=fs["every"]; cur=l; break
            else:
                for l in restr:
                    if l.remaining>0 and ok(l,cursor): pick=l; break
            if pick is None and g.get("bonus",{}).get("enabled"):
                for l in restr:
                    room=math.floor(l.planned*g["bonus"]["overshootPct"]/100)-l.bonus
                    if l.remaining==0 and room>0 and ok(l,cursor): pick=l; bonus=True; break
            if pick is None: break
            if flipPending and cursor+pick.exp>flip["meridianAtS"]+flip["maxAfterMin"]*60:
                w=flip["meridianAtS"]+flip["afterMin"]*60
                out.append({"atS":cursor,"cmd":"wait","untilS":w}); cursor=w; continue
            out.append({"atS":cursor,"cmd":"expose","line":pick.id,"bonus":bonus})
            if bonus: pick.bonus+=1
            else: pick.remaining-=1
            if fs.get("enabled"): stackLeft-=1
            cursor+=pick.exp+pick.dl
    return out

def check(path):
    g=json.loads(pathlib.Path(path).read_text())
    blocks,diag,units,assigned=allocate(g["input"])
    ents=entries(g["input"],units,assigned)
    exp=g["expected"]; ok=True
    if blocks!=exp["blocks"]: ok=False; print(path,"BLOCKS\n got",blocks,"\n exp",exp["blocks"])
    if "diagnostics" in exp and diag!=exp["diagnostics"]: ok=False; print(path,"DIAG got",diag,"exp",exp["diagnostics"])
    if "entries" in exp and ents!=exp["entries"]: ok=False; print(path,"ENTRIES\n got",ents,"\n exp",exp["entries"])
    return ok

if __name__=="__main__":
    d=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else ".")
    res=[check(p) for p in sorted(d.glob("G*.json"))]
    print(f"{sum(res)}/{len(res)} Soll-Pläne bestanden"); sys.exit(0 if all(res) else 1)
