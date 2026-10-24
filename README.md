# LinkPass

Free and open source link-in-bio generator with a digital pass concept. Design one card with all your important links and share a single link.

Live demo: https://linkpass.xsrazy.web.id

## What it is

LinkPass turns a list of links into a digital pass, like a boarding pass or a backstage card, with a QR stub and a barcode. Instead of sending people a plain list, you share one card that holds your identity and every link that matters.

## Features

- Digital pass card with a QR stub and a real barcode
- Profile identity: name, username, label, short bio, location, and profile photo
- Photo upload: JPG, PNG, or WebP, cropped to a square and compressed automatically. On desktop you can also drag a file into the editor or paste from the clipboard.
- 9 pass skins: Backstage, Boarding Pass, Vinyl Sunset, Arcade, Struk Belanja (shopping receipt), Botanical, KTP (ID card), Paspor (passport), and Bioskop (cinema)
- Multiple fonts and accent colors
- Link ordering, from the most important link first, with featured links
- Sample content presets to start from, plus a random vibe generator
- A pass strength meter that scores profile completeness
- Two ways to share:
  - Hash link: the whole pass is encoded in the URL, so no server stores your profile.
  - Short link: the pass is stored on the server and shared as a short URL such as `linkpass.xsrazy.web.id/p/x8k2p`. No login is required. A secret manage link is the only key to edit the pass, view visit and click statistics, or delete it.
- Optional recovery email for short links. It is only used to verify a request for a new manage link. This version does not send automatic emails.
- Owner admin dashboard with totals, recent passes, search, and disable, delete, and manage link reset actions.
- Per pass Open Graph previews, so a shared short link shows the pass owner name, bio, and photo in chat previews.
- Standalone HTML export and JSON export and import as backups.

## How sharing works

### Hash link (no server storage)

The editor encodes the whole pass into the URL fragment. Anyone who opens that link sees exactly the same pass, and no server ever stores the profile. This is the original sharing mode and it still works.

### Short link (server storage)

When you choose "Simpan sebagai short link" in the editor, the pass is saved on the server and you get two links:

- A short public link, such as `linkpass.xsrazy.web.id/p/x8k2p`, to share anywhere.
- A secret manage link, shown only once, to edit the pass, view statistics, or delete it. Whoever holds this link is treated as the owner, so keep it safe.

Statistics count unique visits per day per IP and unique clicks per day per IP per link, so reloading the same pass does not inflate the numbers.

## Project structure

- `index.html`: editor and public pass view
- `manage.html`: owner manage page, opened through the secret manage link
- `admin.html`: owner admin dashboard
- `api/p-page.js`: Vercel function that serves `/p/<slug>` with per pass Open Graph tags
- `linkpass-worker/`: Cloudflare Worker API and D1 schema for short links, statistics, and admin actions
- `assets/`: favicon, logo, and Open Graph image

## Tech

- Frontend: plain HTML, CSS, and JavaScript, deployed on Vercel.
- Backend: Cloudflare Worker with a Cloudflare D1 database. No framework, and no login system for end users in version 1.

## Deploy

Frontend: deploy the repository root on Vercel. The hash link mode works on any static host, but short links need the Vercel function in `api/`.

Backend: deploy the Worker from `linkpass-worker/` with Wrangler. It needs a D1 database binding named `DB` and an `ADMIN_KEY` secret for the admin dashboard. Set it with:

```sh
wrangler secret put ADMIN_KEY
```

## Limits to know

- The D1 free tier allows 100,000 writes per day. One visit or one click counts as one write, so a pass with extremely high traffic can reach that ceiling. Statistics writes fail soft and never block pass creation.
- Version 1 has no custom slugs, no automatic recovery emails, and no user login. Those are planned for a later phase.

## Sponsor

If LinkPass is useful to you, you can support it through the Sponsor button on this repository.

## License

MIT. See [LICENSE](LICENSE).
