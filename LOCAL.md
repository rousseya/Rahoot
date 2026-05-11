# Build & Deploy

The VM has only 1 GB RAM — **build locally and push artifacts**:

```bash
# On your local machine
cd /home/rousseya/projects/Rahoot
pnpm install && pnpm build

# Push build artifacts to ZOZO
rsync -avz packages/web/.next/ rousseya@192.168.1.184:/home/rousseya/Rahoot/packages/web/.next/
rsync -avz packages/web/.next/static/ rousseya@192.168.1.184:/home/rousseya/Rahoot/packages/web/.next/standalone/packages/web/.next/static/
rsync -avz packages/web/public/ rousseya@192.168.1.184:/home/rousseya/Rahoot/packages/web/.next/standalone/packages/web/public/
rsync -avz packages/socket/dist/ rousseya@192.168.1.184:/home/rousseya/Rahoot/packages/socket/dist/

# Restart on ZOZO
ssh rousseya@192.168.1.184
sudo systemctl restart rahoot
systemctl is-active rahoot
```

# GitHub Workflow

Use this flow to publish your changes on GitHub:

```bash
# From project root
cd /home/rousseya/projects/Rahoot

# Check your current branch and changes
git status
git branch --show-current

# Optional: update local main then return to your branch
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout image-answers
git rebase main

# Commit your work
git add .
git commit -m "feat: add manager quiz import support"

# Push branch
git push -u origin image-answers

# Create PR (if GitHub CLI is installed)
gh pr create --base main --head image-answers --fill
```

If GitHub CLI is not installed, open this in your browser after push:

https://github.com/ziv-airis/Rahoot/compare/main...image-answers

# Secrets Security (ZOZO)

Goal: ensure Hugging Face tokens stay private and are never exposed to users.

## Required permissions

On ZOZO, the runtime secret file must be readable only by the service user:

```bash
ssh rousseya@192.168.1.184
chmod 600 /home/rousseya/Rahoot/.env
chmod 700 /home/rousseya/Rahoot/start.sh
ls -l /home/rousseya/Rahoot/.env /home/rousseya/Rahoot/start.sh
```

Expected:

- `.env` -> `-rw-------` (600)
- `start.sh` -> `-rwx------` (700)

## Public exposure checks

Verify secrets are not served by the web app:

```bash
curl -i http://127.0.0.1:4000/.env
curl -s http://127.0.0.1:4000/env
```

Expected:

- `/.env` returns `404`
- `/env` returns only safe public values (`webUrl`, `socketUrl`, `googleClientId`)

## Logging checks

Verify the service logs do not contain token values:

```bash
journalctl -u rahoot --no-pager -n 400 | grep -E "HUGGINGFACE_TOKEN|HF_TOKEN|Authorization: Bearer|Bearer [A-Za-z0-9_-]{10,}" -n || true
```

Expected: no match.

## Git safety

Never commit runtime secrets:

- `.env` must stay untracked (`.gitignore` includes `.env`)
- only `.env.example` is versioned

If a token is ever exposed in logs, terminal history, or screenshots:

1. Revoke it in Hugging Face immediately.
2. Generate a new token.
3. Update local and ZOZO `.env`.
4. Restart `rahoot`.
