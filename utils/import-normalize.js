const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip'); // npm i adm-zip

async function isDirectory(p) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch (e) {
    return false;
  }
}

async function ensureDir(p) {
  try { await fs.mkdir(p, { recursive: true }); } catch (e) {}
}

async function extractZip(zipPath, dest) {
  const zip = new AdmZip(zipPath);
  await ensureDir(dest);
  zip.extractAllTo(dest, true);
  return dest;
}

async function listDirEntries(dir) {
  const names = await fs.readdir(dir);
  const entries = await Promise.all(
    names.map(async name => {
      const full = path.join(dir, name);
      const st = await fs.stat(full);
      return { name, full, isDirectory: st.isDirectory(), isFile: st.isFile() };
    })
  );
  return entries;
}

// If export packages everything into one top-level folder (common on iPhone),
// unwrap single-child directories up to a few levels.
async function normalizeRoot(dir, maxUnwrapLevels = 3) {
  let cur = dir;
  for (let i = 0; i < maxUnwrapLevels; i++) {
    const entries = await listDirEntries(cur);
    // if there is exactly one entry and it's a directory, descend into it
    const onlyDirs = entries.filter(e => e.isDirectory);
    const onlyFiles = entries.filter(e => e.isFile);
    if (entries.length === 1 && onlyDirs.length === 1 && onlyFiles.length === 0) {
      cur = onlyDirs[0].full;
      continue;
    }
    // otherwise stop
    break;
  }
  return cur;
}

// Recursively find message JSON files (flexible patterns). Return absolute file paths.
async function findMessageJsons(dir, results = []) {
  const entries = await listDirEntries(dir);
  for (const e of entries) {
    if (e.isFile) {
      const base = path.basename(e.name).toLowerCase();
      // common patterns: messages.json, messages_1.json, message.json, thread_messages.json
      if (
        base.endsWith('.json') &&
        (base.includes('message') || base.includes('messages'))
      ) {
        results.push(e.full);
      }
    } else if (e.isDirectory) {
      await findMessageJsons(e.full, results);
    }
  }
  return results;
}

// Find media files optionally (images, videos, audio). Returns a map of arrays.
async function findMedia(dir, results = { photos: [], videos: [], audio: [] }) {
  const entries = await listDirEntries(dir);
  for (const e of entries) {
    if (e.isFile) {
      const ext = path.extname(e.name).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp'].includes(ext)) results.photos.push(e.full);
      else if (['.mp4', '.mov', '.m4v', '.3gp'].includes(ext)) results.videos.push(e.full);
      else if (['.aac', '.m4a', '.mp3', '.wav'].includes(ext)) results.audio.push(e.full);
    } else if (e.isDirectory) {
      await findMedia(e.full, results);
    }
  }
  return results;
}

// Clean up directory recursively
async function rimraf(p) {
  // Node 14+ supports fs.rm, but use recursive readdir+unlink for portability
  try {
    const st = await fs.stat(p);
  } catch (e) {
    return;
  }
  const entries = await fs.readdir(p);
  await Promise.all(entries.map(async name => {
    const full = path.join(p, name);
    const st = await fs.stat(full);
    if (st.isDirectory()) await rimraf(full);
    else await fs.unlink(full);
  }));
  await fs.rmdir(p);
}

async function processUpload(uploadPath, options = {}) {
  // uploadPath: path to directory OR .zip file
  // options:
  //   cleanupZip (default true) - remove extracted temp after user processes or you can pass false
  const cleanup = options.cleanup ?? true;

  let tempDir;
  let workingDir;
  let createdTempDir = false;

  try {
    const ext = path.extname(uploadPath).toLowerCase();
    if (ext === '.zip') {
      // create temp dir
      tempDir = path.join(os.tmpdir(), `insta-import-${uuidv4()}`);
      await ensureDir(tempDir);
      createdTempDir = true;
      await extractZip(uploadPath, tempDir);
      workingDir = tempDir;
    } else {
      // assume directory
      if (!(await isDirectory(uploadPath))) {
        throw new Error('uploadPath is not a directory or a .zip file');
      }
      workingDir = uploadPath;
    }

    // normalize single-folder exports (unwrap typical iPhone zip root folder)
    const normalizedRoot = await normalizeRoot(workingDir, 5);

    // find message json files (at least one required)
    const messageFiles = await findMessageJsons(normalizedRoot);
    if (!messageFiles || messageFiles.length === 0) {
      // as a fallback, try scanning the original working dir recursively (if we had normalized)
      const fallback = await findMessageJsons(workingDir);
      if (fallback.length === 0) {
        throw new Error('No message JSON file found in upload. The upload must contain at least one messages JSON file.');
      } else {
        // use fallback (rare)
        return {
          root: workingDir,
          messageFiles: fallback,
          media: await findMedia(workingDir),
          tempDir: tempDir,
          cleanup: async () => { if (cleanup && createdTempDir) await rimraf(tempDir); }
        };
      }
    }

    // find media optionally
    const media = await findMedia(normalizedRoot);

    return {
      root: normalizedRoot,
      messageFiles,
      media,
      tempDir,
      cleanup: async () => { if (cleanup && createdTempDir) await rimraf(tempDir); }
    };

  } catch (err) {
    // try to cleanup on error
    if (createdTempDir && tempDir) {
      try { await rimraf(tempDir); } catch (e) {}
    }
    throw err;
  }
}

module.exports = { processUpload };
