# Lumina Gallery — Static Edition

A pure HTML/CSS/JS photo gallery powered by Google Drive.  
**No build step. No Node.js. No framework.**  
Drop the four files onto Vercel (or any static host) and you're live.

---

## Files

```
lumina-gallery/
├── index.html   ← App shell
├── style.css    ← All styles (no Tailwind, no preprocessor)
├── app.js       ← All logic (no React, no bundler)
├── config.js    ← ← ← Edit this one
└── vercel.json  ← Vercel deployment settings
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

If `config.js` still has the placeholder credentials, the gallery automatically loads 30 sample photos from [picsum.photos](https://picsum.photos) so you can preview the UI immediately.

---

## Customisation

| What | Where |
|---|---|
| Gallery title & subtitle | `CONFIG.GALLERY_TITLE` / `CONFIG.GALLERY_SUBTITLE` in `config.js` |
| Images per page | `CONFIG.PAGE_SIZE` in `config.js` |
| Default sort | `CONFIG.DEFAULT_SORT` / `CONFIG.DEFAULT_SORT_DIR` in `config.js` |
| Accent colour | `--accent` CSS variable at the top of `style.css` |
| Fonts | `<link>` tag in `index.html` + `font-family` in `style.css` |

---

## Features

- ✅ Masonry grid layout (CSS columns)
- ✅ Lazy loading with IntersectionObserver
- ✅ Infinite scroll pagination
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
