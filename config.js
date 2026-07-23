// ============================================================
//  LUMINA GALLERY — CONFIGURATION
//  Edit this file to connect your Google Drive folder.
// ============================================================

const CONFIG = {
  // ── Google Drive ──────────────────────────────────────────
  // Your Google Drive Folder ID (from the URL: drive.google.com/drive/folders/<FOLDER_ID>)
  FOLDER_ID: '1JnvFEPIP77Kg3ef9UFaLQDM6K3ftBs8m',

  // Your Google API Key (see README.md for setup instructions)
  // Create one at: https://console.cloud.google.com/apis/credentials
  API_KEY: 'AIzaSyC4TammK5wBJrl9-cL1BOfb4Q-qJFHEAPg',

  // ── Gallery Settings ─────────────────────────────────────
  // Number of images to load per page (pagination batch size)
  PAGE_SIZE: 30,

  // Supported image MIME types to display
  SUPPORTED_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/tiff',
    'image/svg+xml',
  ],

  // ── UI Settings ───────────────────────────────────────────
  GALLERY_TITLE: 'K&S Wedding Gallery',
  GALLERY_SUBTITLE: 'My Wedding Photo Collection',

  // Default sort order: 'name' | 'createdTime' | 'modifiedTime'
  DEFAULT_SORT: 'createdTime',

  // Default sort direction: 'asc' | 'desc'
  DEFAULT_SORT_DIR: 'desc',
}
