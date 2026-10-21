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

## Booking form

"Book a scan" goes to `book.html`, a form that posts to
[FormSubmit](https://formsubmit.co), which emails the answers to the address
in `content/site.json`. GitHub Pages can't send mail on its own.

The first submission sends that address an activation email instead of the
booking; nothing arrives until the link in it is clicked. Changing the email
in `site.json` means activating again. After sending, visitors land on
`thanks.html`.

## Pricing calculators

The pricing-card estimator, the booking form's estimate and the "Build your
job" section all quote from one JSON block the build writes into each page
(`id="pricing-data"`), through `quote()` in `js/main.js`. Prices are edited only in
`content/site.json` (or the dashboard). The job builder's questions and its
package recommendations are fixed in `build.mjs` and `js/main.js`, since the
logic depends on them; its prices are not.
