# Lumina Gallery — Static Edition

A pure HTML/CSS/JS photo gallery powered by Google Drive.  
**No build step. No Node.js. No framework.**  
Drop these files onto Vercel (or any static host) and you're live.

---

## Files

```
lumina-gallery/
├── index.html   ← App shell (gallery + album selector + lightbox)
├── admin.html   ← /admin — password-gated settings & albums editor
├── style.css    ← All styles (no Tailwind, no preprocessor)
├── app.js       ← Gallery logic (no React, no bundler)
├── admin.js     ← Admin page logic
├── config.js    ← ← ← Edit this one (API key, admin password, legacy single-folder fallback)
├── albums.json  ← Site settings + album registry (edit via /admin, or by hand)
└── vercel.json  ← Vercel deployment settings (cleanUrls makes /admin work)
```

---

## Quick Start

### 1. Configure Google Drive

**Get your Folder ID**

1. Open the Google Drive folder containing your photos.
2. Copy the ID from the URL:  
   `https://drive.google.com/drive/folders/`**`1aBcDeFgHiJkLmNoPqRsTuVwXyZ`**

**Create an API Key**

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials → API Key**
3. Click **Edit API Key**, then under *API restrictions* select **Google Drive API**
4. Under *Website restrictions* add your domain (e.g. `https://my-gallery.vercel.app/*`)
5. Copy the key

**Edit `config.js`**

```js
const CONFIG = {
  FOLDER_ID: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ',  // ← paste here
  API_KEY:   'AIzaSy…',                         // ← paste here

  GALLERY_TITLE:    'My Gallery',
  GALLERY_SUBTITLE: 'My Photo Collection',
  // ... other options
}
```

**Make the folder public**

In Google Drive: right-click the folder → **Share** → **Anyone with the link** (Viewer).

---

### 2. Enable the Google Drive API

1. In the Google Cloud Console, go to **APIs & Services → Library**
2. Search for **Google Drive API** and click **Enable**

---

### 3. Deploy to Vercel

**Option A — Drag & Drop (fastest)**

1. Go to [vercel.com/new](https://vercel.com/new)
2. Drag the entire `lumina-gallery/` folder onto the upload area
3. Click **Deploy**

No build command needed — Vercel detects a static site automatically.

**Option B — GitHub**

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create lumina-gallery --public --push
```

Then import the repo at [vercel.com/import](https://vercel.com/import).  
Leave **Build Command** and **Output Directory** blank (or set Output Directory to `.`).

**Option C — Vercel CLI**

```bash
npm i -g vercel
cd lumina-gallery
vercel
```

Follow the prompts; when asked for a build command, leave it empty.

---

## Multi-Album Admin

The gallery supports multiple albums, each backed by its own Google Drive folder — e.g. **Ceremony**, **Reception**, **Family**, **Friends**. Visitors switch between them instantly with no page reload and no extra network requests, because every album's photos are loaded once, up front, and kept in memory.

### How it works

- **`albums.json`** is the shared source of truth — a plain JSON file with a `settings` block (site title/subtitle/hero image) and an `albums` array, loaded once when the gallery starts:
  ```json
  {
    "settings": {
      "title": "K&S Wedding Gallery",
      "subtitle": "Our Wedding Photo Collection",
      "heroImage": ""
    },
    "albums": [
      {
        "id": "ceremony",
        "name": "Ceremony",
        "folderUrl": "https://drive.google.com/drive/folders/xxxxxxxx",
        "order": 1,
        "visible": true,
        "default": true,
        "cover": null,
        "imageCount": null
      },
      {
        "id": "reception",
        "name": "Reception",
        "folderUrl": "https://drive.google.com/drive/folders/yyyyyyyy",
        "order": 2,
        "visible": true
      }
    ]
  }
  ```
- On startup, the gallery fetches **every visible album's Drive folder in full** (looping pagination internally), tags each photo with its `albumId`, and stores the combined result in memory. The Album Selector is built dynamically — no code changes needed to add, rename, reorder, or hide an album.
- Switching albums, sorting, and searching are all pure in-memory filters (`getFilteredImages()` in `app.js`), and the *results* of each filter/sort combination are cached (`state.filterCache`) — flipping back to an album or sort you've already viewed doesn't re-filter or re-sort the same array again. None of this touches the network after the initial load.
- **Album counts.** Each chip shows a live count, e.g. `Ceremony (108)`, computed once from the loaded photos.
- **Default album.** Mark one album `"default": true` in `albums.json` (or via the admin's "Default" radio) and visitors land on it automatically. A URL always wins over the default — see below.
- **URL support.** Opening `/?album=family` or `/#family` opens that album directly (matched against the album's `id` or a slugified version of its `name`); switching albums updates the URL the same way, so links are shareable/bookmarkable.
- **Empty albums** get a dedicated "📷 No photos in this album." state, distinct from the search-empty and error states.
- **Preloading.** Right after startup, the first `PAGE_SIZE` thumbnails of *every* album (not just the one showing) are quietly warmed into the browser's image cache via idle-time `Image()` prefetches — no extra Drive requests, since the URLs are already known from the initial load — so switching into any album feels instant.
- **Backward compatible:** if `albums.json` doesn't exist, or none of its entries have a valid folder URL, the gallery falls back to a single "All Photos" album using `CONFIG.FOLDER_ID`/`CONFIG.GALLERY_TITLE`/`CONFIG.GALLERY_SUBTITLE` — i.e. existing single-folder deployments keep working unmodified, and the Album Selector stays hidden (it only appears once there's more than one visible album).

### Managing albums from `/admin`

Open `/admin` (there's a small 🔒 link in the gallery's toolbar). It's intentionally minimal — no dashboard, no CMS:

1. **Password screen.** Enter the one password set in `config.js` (`CONFIG.ADMIN_PASSWORD`). There are no accounts, no roles — just a single shared password.
   > ⚠️ This is a **client-side check only** — there's no server to keep a secret on, so the password is visible to anyone who reads `config.js`'s source. It keeps casual visitors out of the editing UI; it is not real access control. Don't reuse a real password, and don't put anything sensitive behind it.
2. **Gallery Settings** — Wedding Title, Subtitle, and an optional Hero Image URL.
3. **Albums** — one row per album: name, Drive folder URL, display order, Visible/Hidden, which one is the Default, and an optional cover image URL.
4. **One Save button.** Clicking it:
   - validates every folder URL,
   - calls the Drive API to **count each folder's images** and, if you didn't set a cover yourself, **auto-detects one from the first image**,
   - saves the result to *this browser's* `localStorage` so the gallery previews it instantly on this device, and
   - **downloads an updated `albums.json`** for you to publish.

**Publishing.** This is a static site with no database, so there's nowhere for `/admin` to durably save changes that every visitor's browser can read directly. Saving previews on your device immediately; to make it live for everyone, replace `albums.json` in the repository with the downloaded file and redeploy (`git commit` + push, or drag-and-drop onto Vercel) — the same way `config.js` already works today. Use **Discard local preview** (below the Save button) to throw away your device's preview and reload whatever `albums.json` currently says.

### Adding a new album's Drive folder

1. Create/choose the Google Drive folder for the album and copy its share link (e.g. `https://drive.google.com/drive/folders/1aBcD...`).
2. Share it the same way as your existing folder: right-click → **Share** → **Anyone with the link** (Viewer).
3. In `/admin`, click **+ Add Album**, paste the folder URL, give it a name, and click **Save**.
4. Replace `albums.json` in your repo with the downloaded file, and redeploy.

All albums share the single `CONFIG.API_KEY` in `config.js` — you don't need a separate API key per folder.

---

## Running Locally

No server needed for viewing, but browsers block `file://` fetch requests.  
Use any static server:

```bash
# Python (built-in)
python3 -m http.server 3000

# Node (npx, no install)
npx serve .

# VS Code
# Install "Live Server" extension, right-click index.html → Open with Live Server
```

Then open `http://localhost:3000`.

---

## Demo Mode

If `config.js` still has the placeholder credentials, the gallery automatically loads 40 sample photos across 4 sample albums (Ceremony / Reception / Family / Friends) from [picsum.photos](https://picsum.photos) so you can preview the UI — including the Album Selector — immediately.

---

## Customisation

| What | Where |
|---|---|
| Gallery title, subtitle & hero image | `/admin` → Gallery Settings, or `CONFIG.GALLERY_TITLE`/`CONFIG.GALLERY_SUBTITLE` in `config.js` as a fallback |
| Albums, their Drive folders, order, visibility, default | `/admin`, or edit `albums.json` directly — see [Multi-Album Admin](#multi-album-admin) |
| Admin password | `CONFIG.ADMIN_PASSWORD` in `config.js` (the one and only place it's set) |
| Images per page (initial + infinite-scroll chunk size) | `CONFIG.PAGE_SIZE` in `config.js` |
| Default sort | `CONFIG.DEFAULT_SORT` / `CONFIG.DEFAULT_SORT_DIR` in `config.js` |
| Accent colour | `--accent` CSS variable at the top of `style.css` |
| Fonts | `<link>` tag in `index.html` + `font-family` in `style.css` |

---

## Features

- ✅ Multiple albums, each its own Drive folder — switch instantly, no reload, no extra requests
- ✅ `/admin` — password-gated, single-Save settings & albums editor (no CMS, no accounts)
- ✅ Album Selector with live photo counts, e.g. `Ceremony (108)`
- ✅ Shareable album links (`?album=family` or `#family`) + an admin-configurable default album
- ✅ Cached in-memory filtering — switching back to an already-viewed album/sort doesn't re-filter
- ✅ Per-album empty state ("No photos in this album")
- ✅ Idle-time thumbnail preloading so every album feels instant to open
- ✅ Masonry grid layout (CSS columns)
- ✅ Lazy loading with IntersectionObserver
- ✅ Infinite scroll (in-memory — all photos load once at startup)
- ✅ Client-side search (filename)
- ✅ Sort by date or name (asc/desc)
- ✅ Fullscreen lightbox with zoom (scroll/keyboard) & pan
- ✅ Touch swipe navigation
- ✅ Keyboard shortcuts: `←` `→` navigate, `Esc` close, `+` `-` `0` zoom
- ✅ Filmstrip thumbnail bar
- ✅ Download button
- ✅ Dark / light mode (persisted)
- ✅ Demo mode (no credentials required)
- ✅ Responsive (mobile → 4-column desktop)
- ✅ Reduced-motion support

---

## Keyboard Shortcuts (Lightbox)

| Key | Action |
|---|---|
| `←` / `→` | Previous / Next image |
| `Esc` | Close lightbox |
| `+` or `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom |

---

## Future Enhancements

- **Zero-redeploy album publishing.** Right now `/admin` previews changes via `localStorage` and publishes via a downloaded `albums.json` you redeploy (see [Multi-Album Admin](#multi-album-admin)). Swapping in a small Vercel Serverless Function backed by Vercel KV or Vercel Blob (or any tiny JSON-store API) would let admin edits go live for every visitor immediately, with no redeploy and no changes to `app.js`'s data model — `loadGalleryConfig()` already isolates the fetch of `albums.json` behind one function, so only that function and the admin page's save step would need to change.
- **Real admin auth.** `CONFIG.ADMIN_PASSWORD` is a client-side check by design (no backend to keep a secret on) — fine for keeping casual visitors out, not real access control. If the site ever needs genuine protection, Vercel's built-in password/SSO protection for a project (or moving the check into the same serverless function suggested above) would close that gap properly.
- **Per-album cover images** are captured in the data model and auto-detected on Save, but aren't rendered anywhere yet — a natural next step for an album "picker" grid instead of (or in addition to) the chip selector.
- **Drag-and-drop reordering** in `/admin` (currently a plain "Order" number per row) for larger album lists.
- **Debounced Drive re-validation.** `/admin`'s Save currently re-counts every album's folder on every save. For galleries with many large albums, only re-validating albums whose folder URL actually changed since the last save would cut down on Drive API calls.
