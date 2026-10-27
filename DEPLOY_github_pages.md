# Publish to GitHub Pages — quick start (English)

Your v2 app is 100% static files, so GitHub Pages hosts it for free.
Publish the **contents of this `app-v2` folder** so the final URL is clean:
`https://<your-username>.github.io/<repo-name>/`

Files that must be published (everything the site needs):
```
index.html
app.js
pdf-extract.js
recipes.js
icons.js
vendor/pdf.min.js
vendor/pdf.worker.min.js
```
(README/DEPLOY/起動する.bat are optional. `verify_extract.node.js` is a dev
test and is excluded by `.gitignore`.)

---

## Option 1 — Website upload (no command line)

1. On github.com, click **New repository**. Name it e.g. `flyer-search`,
   set **Public**, and create it (don't add a README).
2. On the empty repo page, click **uploading an existing file**.
3. From your PC, open the `app-v2` folder and drag **its contents** into the
   browser — including the **`vendor` folder** (both files inside it).
   - Tip: select `index.html`, `app.js`, `pdf-extract.js`, `recipes.js`,
     `icons.js`, and the `vendor` folder, then drop them together.
4. Click **Commit changes**.
5. Go to **Settings → Pages**.
6. Under **Build and deployment**, set **Source = Deploy from a branch**,
   **Branch = main**, folder **/(root)**, then **Save**.
7. Wait ~1 minute, refresh the Pages settings page, and open the URL it shows:
   `https://<your-username>.github.io/flyer-search/`

Done. Share that URL; it works on phones and PCs, and PDF import works
because it's served over https (no `file://` limitation).

---

## Option 2 — Command line (git)

Run these **inside the `app-v2` folder** (so its contents become the repo root).
Replace `<your-username>` and the repo name.

```bash
git init
git add index.html app.js pdf-extract.js recipes.js icons.js vendor .gitignore README_使い方.md
git commit -m "Flyer search app v2 (in-browser PDF import)"
git branch -M main
git remote add origin https://github.com/<your-username>/flyer-search.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source = Deploy from a branch →
Branch = main → /(root) → Save.** Your site appears at
`https://<your-username>.github.io/flyer-search/`.

> Make sure the `vendor` folder (pdf.min.js + pdf.worker.min.js) is committed —
> without it, PDF import will not work.

---

## Updating later (new flyer week)

- Using Option 1: repeat the upload (or edit files) and commit — Pages
  redeploys automatically in ~1 minute.
- Using git:
  ```bash
  git add -A
  git commit -m "Update"
  git push
  ```

Note: the app imports the PDF in the browser each time; you don't have to
change code weekly. You only redeploy if you change the app itself.

---

## Troubleshooting

- **Blank page / 404 on Pages**: wait 1–2 minutes after enabling Pages; confirm
  Branch = main and folder = /(root).
- **PDF import does nothing**: confirm `vendor/pdf.min.js` and
  `vendor/pdf.worker.min.js` were uploaded (open
  `https://.../<repo>/vendor/pdf.min.js` — it should show code, not 404).
- **Old data showing**: v2 caches the last import in the browser. Re-import the
  PDF, or use a private window.

---

## Alternatives (also free, same files)

- **Netlify Drop**: go to app.netlify.com/drop and drag the `app-v2` folder in.
  Instant URL, no account step required to preview.
- **Vercel / Cloudflare Pages**: connect the GitHub repo and deploy.
