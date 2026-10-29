# Face Finder

A standalone static website that searches a Google Drive folder for your face. All image processing runs in the visitor's browser. Nothing is uploaded to an app backend. Google receives API requests; jsDelivr supplies the model and library assets. Photos, access tokens, and reference embeddings stay in memory and are discarded on reload.

## Run and host

Serve this folder with any static web host over HTTPS (or localhost for development). No build step or server secrets are needed. For a local preview with Python installed: `python -m http.server 5173 --bind 127.0.0.1`, then visit http://localhost:5173.

## Google setup (required for Drive access)

1. Create a Google Cloud project and enable Google Drive API.
2. Configure Google Auth Platform consent settings. For a personal testing app, add your Google account as a test user.
3. Create an OAuth client of type **Web application**. Add the exact website origin (scheme and hostname, with port for localhost) under Authorized JavaScript origins. For local development add `http://localhost:5173`.
4. Paste the public client ID into the app and click Connect Google Drive. Do not paste a client secret; this app never needs one.
5. Choose a clear reference photo containing exactly one face, paste the Drive folder link, and start scanning. Subfolders are included by default. The signed-in account must have download access to the source photos.

The app requests `drive.readonly` to enumerate and download existing folder photos. It never modifies Drive. Public distribution may require Google OAuth verification for this scope. A hosted site alone does not configure Google OAuth.

## Behavior and limits

- Uses pinned @vladmandic/human 3.3.6 detection and face embeddings. Model files download on first use. The default matching similarity is a starting point, not a probability or an accuracy guarantee; adjust while reviewing known photos.
- Solo means the reference face matches and exactly one face was detected. Hidden, distant, or tiny faces can be missed. It does not establish that no other people are present.
- Images are processed sequentially and resized to a maximum of 1600 pixels. Only small result previews are retained; source blobs are released after each photo. Keep the tab open during a scan.
- JPEG, PNG, and WebP are supported. Other image types, including HEIC/RAW, are counted as unsupported; convert them first. Individual failed downloads/decodes are listed for review. Google Photos is a separate service and is not included.
- Cancellation preserves completed results. If your Google token expires, reconnect and start a new scan. Export writes the currently filtered matches as CSV with Drive links.

## Verification

JavaScript syntax has been checked with `node --check app.js`. Real Drive/OAuth, browser inference, and hosted deployment still need end-to-end verification with your account and reference photo.

## References

- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
- https://developers.google.com/workspace/drive/api/guides/manage-downloads
- https://github.com/vladmandic/human/wiki/Embedding
