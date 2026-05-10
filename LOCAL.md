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
