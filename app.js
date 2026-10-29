const $ = (id) => document.getElementById(id);
const scope = 'https://www.googleapis.com/auth/drive.readonly';
const supported = new Set(['image/jpeg', 'image/png', 'image/webp']);
let humanPromise, reference, token = '', expires = 0, busy = false, stopped = false;
let rows = [], issues = [];
$('origin').textContent = location.origin;
const status = (message) => { $('status').textContent = message; };

async function model() {
  if (!humanPromise) humanPromise = (async () => {
    status('Loading face models. The first load can take a minute…');
    const { default: Human } = await import('https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js');
    const instance = new Human({
      backend: 'webgl', modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/',
      cacheSensitivity: 0, async: false,
      face: { enabled: true, detector: { maxDetected: 100, minConfidence: 0.3, rotation: true },
        description: { enabled: true }, mesh: { enabled: false }, iris: { enabled: false },
        emotion: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } },
      body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false },
    });
    await instance.load();
    return instance;
  })().catch((error) => { humanPromise = undefined; throw error; });
  return humanPromise;
}

async function canvasFrom(blob, maxSide = 1600) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

function preview(canvas) {
  const small = document.createElement('canvas');
  const scale = Math.min(1, 400 / Math.max(canvas.width, canvas.height));
  small.width = Math.max(1, Math.round(canvas.width * scale));
  small.height = Math.max(1, Math.round(canvas.height * scale));
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', 0.75);
}

function lock(value) {
  busy = value;
  for (const id of ['reference', 'client', 'folder', 'recursive', 'connect', 'scan']) $(id).disabled = value;
  $('stop').hidden = !value;
}

$('reference').addEventListener('change', async () => {
  const file = $('reference').files[0];
  if (!file || busy) return;
  lock(true);
  reference = undefined;
  rows = []; render();
  $('portrait').hidden = true;
  $('reference-label').textContent = 'Checking portrait…';
  try {
    const human = await model();
    const canvas = await canvasFrom(file);
    const result = await human.detect(canvas);
    if (result.face.length !== 1 || !result.face[0].embedding?.length) {
      throw new Error('Choose a clear portrait containing exactly one visible face.');
    }
    reference = Array.from(result.face[0].embedding);
    $('portrait').src = preview(canvas);
    $('portrait').hidden = false;
    $('reference-label').textContent = 'Portrait ready · choose another';
    status('Reference ready. Connect Drive and choose a folder to scan.');
  } catch (error) {
    $('reference-label').textContent = '＋ Choose another reference photo';
    status(`Reference could not be loaded: ${error.message}`);
  } finally { lock(false); }
});

$('connect').addEventListener('click', () => {
  const clientId = $('client').value.trim();
  if (!clientId.endsWith('.apps.googleusercontent.com')) return status('Paste your Google Web application OAuth client ID first.');
  if (!window.google?.accounts?.oauth2) return status('Google sign-in has not loaded. Check your connection or content blocker, then try again.');
  $('connect').disabled = true;
  const finish = () => { $('connect').disabled = false; };
  try {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope,
      callback: (response) => {
        finish();
        if (response.error) return status(`Google sign-in failed: ${response.error}`);
        if (!google.accounts.oauth2.hasGrantedAllScopes(response, scope)) return status('Read-only Drive permission is needed to scan the folder.');
        token = response.access_token;
        expires = Date.now() + Number(response.expires_in) * 1000;
        $('connection').textContent = 'Connected · read only';
        status('Drive connected. Choose your reference portrait and folder, then start scanning.');
      },
      error_callback: (error) => { finish(); status(`Google sign-in did not finish: ${error.type}`); },
    });
    client.requestAccessToken({ prompt: '' });
  } catch (error) { finish(); status(`Google sign-in failed: ${error.message}`); }
});

async function drive(path, parameters = {}, media = false) {
  if (!token || Date.now() >= expires - 10000) {
    token = ''; $('connection').textContent = 'Reconnect needed';
    throw new Error('Google access expired. Reconnect Drive and start another scan.');
  }
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); continue;
    }
    if (response.status === 401) { token = ''; $('connection').textContent = 'Reconnect needed'; throw new Error('Google access expired. Reconnect Drive.'); }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error?.message || `Drive request failed (${response.status}).`);
    }
    return media ? response.blob() : response.json();
  }
}

function folderId(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/\/folders\/([\w-]+)/);
  const id = match ? match[1] : trimmed;
  if (!/^[\w-]+$/.test(id)) throw new Error('Paste a valid Drive folder URL or folder ID.');
  return id;
}

async function listPhotos(root, recursive) {
  const queue = [root], visited = new Set(), photos = new Map();
  let unsupported = 0;
  while (queue.length && !stopped) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    let pageToken = '';
    do {
      const data = await drive('files', {
        q: `'${id}' in parents and trashed = false and (mimeType contains 'image/' or mimeType = 'application/vnd.google-apps.folder')`,
        pageSize: 1000, fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType)',
        supportsAllDrives: true, includeItemsFromAllDrives: true, ...(pageToken ? { pageToken } : {}),
      });
      if (data.incompleteSearch) throw new Error('Drive reported an incomplete folder listing. Narrow the folder and retry.');
      for (const file of data.files || []) {
        if (file.mimeType === 'application/vnd.google-apps.folder') { if (recursive) queue.push(file.id); }
        else if (supported.has(file.mimeType)) photos.set(file.id, file);
        else unsupported++;
      }
      pageToken = data.nextPageToken;
      status(`Finding photos… ${photos.size} supported images found.`);
    } while (pageToken && !stopped);
  }
  return { photos: [...photos.values()], unsupported };
}

$('scan').addEventListener('click', async () => {
  if (busy) return;
  if (!reference) return status('Choose a reference portrait first.');
  if (!token) return status('Connect Google Drive first.');
  let id;
  try { id = folderId($('folder').value); } catch (error) { return status(error.message); }
  stopped = false; rows = []; issues = [];
  render(); renderIssues(); lock(true);
  let completed = 0, total = 0, unsupported = 0;
  try {
    status('Checking folder access…');
    const folder = await drive(`files/${encodeURIComponent(id)}`, { fields: 'mimeType', supportsAllDrives: true });
    if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('The selected Drive item is not a folder.');
    const listing = await listPhotos(id, $('recursive').checked);
    total = listing.photos.length; unsupported = listing.unsupported;
    const human = await model();
    $('progress').hidden = false; $('progress').max = total || 1; $('progress').value = 0;
    for (const file of listing.photos) {
      if (stopped) break;
      status(`Scanning ${completed + 1} of ${total}: ${file.name}`);
      try {
        const blob = await drive(`files/${encodeURIComponent(file.id)}`, { alt: 'media', supportsAllDrives: true }, true);
        const canvas = await canvasFrom(blob);
        const result = await human.detect(canvas);
        let score = -1;
        for (const face of result.face) {
          if (face.embedding?.length) score = Math.max(score, human.match.similarity(reference, face.embedding));
        }
        // Retain a small preview, never the full source photo or other people's face descriptors.
        if (score >= 0.30) rows.push({ id: file.id, name: file.name, score, faces: result.face.length, preview: preview(canvas) });
      } catch (error) {
        issues.push(`${file.name}: ${error.message}`);
        if (!token) throw error;
      }
      completed++; $('progress').value = completed;
      render();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    status(`${stopped ? 'Stopped' : 'Finished'}: ${completed}/${total} photos processed · ${issues.length} failed · ${unsupported} unsupported image files. ${!total ? 'No supported photos were found in this folder.' : 'Review matches and adjust similarity if needed.'}`);
  } catch (error) { status(`Scan interrupted after ${completed}/${total} photos: ${error.message}`); }
  finally { lock(false); render(); renderIssues(); }
});

$('stop').addEventListener('click', () => { stopped = true; status('Stopping after the current request or photo…'); });
function filtered() {
  const threshold = Number($('threshold').value);
  return rows.filter((row) => row.score >= threshold && (!$('solo').checked || row.faces === 1)).sort((a, b) => b.score - a.score);
}
function render() {
  const matches = filtered();
  $('threshold-value').textContent = Number($('threshold').value).toFixed(2);
  $('count').textContent = `${matches.length} matching photo${matches.length === 1 ? '' : 's'}`;
  $('export').disabled = matches.length === 0;
  const gallery = $('gallery'); gallery.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.textContent = busy ? 'Scanning your collection…' : 'No matches to show. Scan photos or adjust the filters.';
    gallery.append(empty);
  }
  for (const row of matches) {
    const card = document.createElement('article'); card.className = 'card';
    const image = new Image(); image.src = row.preview; image.alt = row.name; image.loading = 'lazy';
    const link = document.createElement('a'); link.href = `https://drive.google.com/file/d/${encodeURIComponent(row.id)}/view`;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = row.name;
    const caption = document.createElement('small');
    caption.textContent = `${row.faces} face${row.faces === 1 ? '' : 's'} detected · similarity ${row.score.toFixed(2)} ↗`;
    link.append(caption); card.append(image, link); gallery.append(card);
  }
}
function renderIssues() {
  $('issues').hidden = issues.length === 0;
  $('issue-count').textContent = `${issues.length} photos could not be processed`;
  $('issue-list').replaceChildren(...issues.map((issue) => { const li = document.createElement('li'); li.textContent = issue; return li; }));
}
for (const id of ['solo', 'threshold']) $(id).addEventListener('input', render);
$('export').addEventListener('click', () => {
  // Prevent spreadsheet formula execution from externally supplied file names.
  const cell = (value) => '"' + String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
  const records = [['Name', 'Detected faces', 'Similarity', 'Drive URL'], ...filtered().map((row) => [row.name, row.faces, row.score.toFixed(3), `https://drive.google.com/file/d/${row.id}/view`])];
  const blob = new Blob(['\uFEFF' + records.map((record) => record.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'my-photo-matches.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
