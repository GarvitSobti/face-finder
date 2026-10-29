# In the frame — Event Photo Finder

Went to an event and received a folder with 400 photos? Find the photos you're in without scrolling through the whole collection.

## How it works

1. Upload a clear reference portrait of yourself.
2. Connect Google Drive with read-only access and paste the event folder link.
3. Scan the photos. The app detects faces in each image and compares them with your reference face.
4. Browse matching photos, including group photos, and open the originals in Drive.
5. Optionally turn on **Solo photos only** to show matches with exactly one detected face.

This is face recognition: detecting a face alone is insufficient; its face embedding must match your reference. Photos with other people are included by default.

## Current implementation

- Static website using JavaScript, HTML, and CSS; no build step.
- Browser-based face detection and recognition using `@vladmandic/human`.
- Google Drive OAuth, folder pagination, and optional recursive subfolder scanning.
- Matching gallery, adjustable similarity threshold, Drive links, and CSV export.
- Progress, cancellation, and a list of failed downloads or image decodes.

Photos, access tokens, and face embeddings stay in the browser tab. No event photos or biometric data belong in this public repository. The app downloads its face models from jsDelivr and reads source photos from Google Drive.

## Run locally

From this folder, with Python installed:

```sh
python -m http.server 5173 --bind 127.0.0.1
```

Open **http://localhost:5173**. Configure a Google Web application OAuth client with that authorized JavaScript origin, then paste its public client ID into the app. No client secret is needed.

## Hosting and Google setup

The site can be served by an HTTPS static host. `netlify.toml` is included. Follow [PROJECT.md](PROJECT.md) for Google Cloud configuration, read-only permissions, supported image formats, and processing details. Google OAuth must authorize the deployed website's exact origin before Drive connection will work.

## Accuracy and status

This is an initial implementation. JavaScript syntax has been checked; browser inference, Google OAuth, and a complete event-folder scan still need end-to-end testing. It is not deployed yet.

Matching is approximate. Review results and adjust the similarity threshold against known photos. The score is not a probability. Solo filtering counts detected faces; small, obscured, or distant faces can be missed. JPEG, PNG, and WebP are supported; HEIC and RAW need conversion.
