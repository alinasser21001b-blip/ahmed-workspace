# دوائي — Dawai (patient prototype)

Arabic-first patient shell for finding nearby medicine availability and holding it for pickup.

Built from [`../DAWAI_DESIGN_SYSTEM.md`](../DAWAI_DESIGN_SYSTEM.md) (Night Mint patient persona).

## Run

```bash
cd dawai
python3 -m http.server 8765
# open http://127.0.0.1:8765
```

## Demo loop

1. **اليوم** — calm home, refill shortcuts  
2. **اطلب** — pick a medicine  
3. Waiting → offers (simulated pharmacist replies)  
4. **حجز** — print-style hold code  
5. **أدويتي** — append-only style record surface  

Demo data only — no API, no diagnosis, no auto-substitutes.
