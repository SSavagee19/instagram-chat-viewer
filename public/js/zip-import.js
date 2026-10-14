// Browser ZIP importer for Instagram export zips
// Requires JSZip and idb (included via CDN in index.html)
// - Validates zip contains audio/, video/, images/, and messages*.json
// - Streams entries (JSZip) and stores JSON as text and media as Blobs in IndexedDB
// - Exposes importZipFile(file, onProgress) returning { messageFiles, totalFiles }

(async () => {
  // Minimal idb wrapper check - expects idb.openDB to be available as `idb.openDB` in the iife build
  const openDB = (self.idb && self.idb.openDB) || (self.idb && self.idb.openDB) || (self.idb && self.idb.openDB);
  if (!openDB) {
    console.warn('idb not available; include idb via CDN');
  }

  async function openChatDB() {
    // Use idb if available, otherwise throw so caller knows idb is required
    if (openDB) {
      return openDB('instagram-chat-viewer', 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('files')) {
            const store = db.createObjectStore('files', { keyPath: 'path' });
            store.createIndex('kind', 'kind');
            store.createIndex('createdAt', 'createdAt');
          }
        }
      });
    } else {
      throw new Error('idb library is required. Add <script src="https://unpkg.com/idb/build/iife/index-min.js"></script>');
    }
  }

  function filePath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  async function importZipFile(file, onProgress = () => {}) {
    if (!file) throw new Error('No file provided');
    if (!file.name || !file.name.toLowerCase().endsWith('.zip')) {
      throw new Error('Please upload a .zip file');
    }

    // Load JSZip
    if (!self.JSZip) throw new Error('JSZip is required. Add <script src="https://unpkg.com/jszip/dist/jszip.min.js"></script>');

    const zip = await self.JSZip.loadAsync(file);
    const filenames = Object.keys(zip.files);

    const hasAudio = filenames.some(p => p.toLowerCase().startsWith('audio/'));
    const hasVideo = filenames.some(p => p.toLowerCase().startsWith('video/'));
    const hasImages = filenames.some(p => p.toLowerCase().startsWith('images/'));
    const messageFiles = filenames.filter(p => /messages.*\.json$/i.test(p));

    if (!hasAudio || !hasVideo || !hasImages || messageFiles.length === 0) {
      throw new Error('Zip must contain audio/, video/, images/ and at least one messages*.json');
    }

    const db = await openChatDB();
    const tx = db.transaction('files', 'readwrite');

    let processed = 0;
    const total = filenames.length;

    for (const path of filenames) {
      const entry = zip.files[path];
      if (entry.dir) {
        processed++;
        onProgress(processed, total, path);
        continue;
      }

      const key = filePath(path);
      let kind = 'other';
      const low = key.toLowerCase();
      if (low.startsWith('audio/')) kind = 'audio';
      else if (low.startsWith('video/')) kind = 'video';
      else if (low.startsWith('images/') || low.startsWith('image/')) kind = 'image';
      else if (/messages.*\.json$/i.test(key)) kind = 'messages';

      try {
        if (kind === 'messages') {
          const text = await entry.async('text');
          await tx.store.put({ path: key, kind, content: text, createdAt: Date.now() });
        } else {
          const blob = await entry.async('blob');
          await tx.store.put({ path: key, kind, blob, name: key.split('/').pop(), size: blob.size, createdAt: Date.now() });
        }
      } catch (err) {
        console.error('Failed to store', key, err);
      }

      processed++;
      onProgress(processed, total, path);
    }

    await tx.done;
    return { messageFiles, totalFiles: total };
  }

  async function clearImportedFiles() {
    const db = await openChatDB();
    const tx = db.transaction('files', 'readwrite');
    await tx.store.clear();
    await tx.done;
  }

  window.igZipImporter = {
    importZipFile,
    clearImportedFiles
  };
})();
