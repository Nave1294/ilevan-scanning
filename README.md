# Ilevan Scanning

A one-page static site. Content lives in `content/`; `build.mjs` turns it into
`dist/`. Pushing to `main` builds and deploys to GitHub Pages.

```bash
node build.mjs
python -m http.server 8765 --directory dist
```

## Editing

- `content/site.json`: headline, services, how it works, contact details.
- `content/work/*.json`: one file per job. `published: false` hides it.
  While nothing is published, the Work section and its nav link are left out.
- Images go in `assets/uploads/`.

The easiest way to do both is the Pages CMS dashboard (app.pagescms.org),
configured by `.pages.yml`: add a job, upload its pictures, paste a
tour link, save. Saving commits here and the site redeploys.

A Realsee link (`https://realsee.ai/…`) or Matterport share link
(`https://my.matterport.com/show/?m=…`) is embedded in
the job's pop-up; any other tour link becomes a button. Gallery images are
shown full width and never cropped; only the card thumbnail is.
