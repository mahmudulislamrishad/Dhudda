#!/usr/bin/env python3
"""Generate one-time DHUDDA Regular/VIP keys and D1 SQL inserts."""
import argparse, hashlib, secrets, string, time
from pathlib import Path
ALPHABET=string.ascii_uppercase+string.digits
def make_key():
    s="".join(secrets.choice(ALPHABET) for _ in range(20))
    return "DH-"+"-".join(s[i:i+5] for i in range(0,20,5))
def digest(s): return hashlib.sha256(s.encode()).hexdigest()
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--regular",type=int,default=0)
    p.add_argument("--vip",type=int,default=0)
    p.add_argument("--out",default="dhudda-keys.sql")
    a=p.parse_args()
    if min(a.regular,a.vip)<0 or a.regular+a.vip<1: p.error("Specify --regular and/or --vip")
    rows=[]; keys=[]
    for kind,count in (("regular",a.regular),("vip",a.vip)):
        for _ in range(count):
            key=make_key(); keys.append((kind,key))
            rows.append(f"INSERT INTO activation_keys(key_hash,key_type,created_at) VALUES('{digest(key)}','{kind}',{int(time.time()*1000)});")
    Path(a.out).write_text("\\n".join(rows)+"\\n",encoding="utf-8")
    print("SAVE THESE KEYS SECURELY. They cannot be recovered from the database.")
    for kind,key in keys: print(f"{kind.upper():7} {key}")
    print(f"SQL saved to {a.out}")
if __name__=="__main__": main()
