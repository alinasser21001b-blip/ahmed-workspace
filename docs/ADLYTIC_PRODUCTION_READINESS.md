# Adlytic Production Readiness — Apply Instructions

> This cloud agent was launched against **ahmed-workspace**, but Adlytic lives in
> a separate repository: https://github.com/alinasser21001b-blip/adlytic
>
> The Cursor bot identity for this run does **not** have push permission to
> `alinasser21001b-blip/adlytic`. The production-ready fixes are therefore
> delivered here as an applyable patch + file mirror.

## Target

- **Repo:** `alinasser21001b-blip/adlytic`
- **Base:** `main` @ `f3f8315`
- **Branch name to create:** `cursor/production-readiness-289c`
- **Local commit already created in the cloned tree:** `f25e9b0`

## Apply (preferred)

```bash
git clone https://github.com/alinasser21001b-blip/adlytic.git
cd adlytic
git checkout -b cursor/production-readiness-289c
git apply ../ahmed-workspace/adlytic-production-readiness.patch
# or copy files from ../ahmed-workspace/adlytic-fixes/ over the matching paths
npm install
npx prisma generate
npx tsc --noEmit
npm run test:worker && npm run test:tenant && npm run test:analytics \
  && npm run test:rules && npm run test:recommendation && npm run test:health
git add -A && git commit -m "fix(prod): close sync races, RBAC gaps, and metric integrity bugs"
git push -u origin cursor/production-readiness-289c
gh pr create --base main --title "Production readiness: sync races, RBAC, metric integrity"
```

## Alternative: copy file mirror

All modified files are under `adlytic-fixes/` with the same relative paths as
in the Adlytic repo. Copy them onto a clean Adlytic checkout at `f3f8315`.

## What was fixed

See the PR body / final report for the root-cause list.
