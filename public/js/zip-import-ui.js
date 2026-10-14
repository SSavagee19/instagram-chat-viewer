// Injects a ZIP import UI into the app and wires it to window.igZipImporter
(function(){
  function createEl(tag, props={}, children=[]) {
    const el = document.createElement(tag);
    Object.assign(el, props);
    (Array.isArray(children)?children:[children]).forEach(c=>{ if (typeof c === 'string') el.appendChild(document.createTextNode(c)); else if (c) el.appendChild(c); });
    return el;
  }

  function ensureContainer(){
    const app = document.getElementById('app') || document.body;
    let panel = document.getElementById('zip-import-panel');
    if (panel) return panel;
    panel = createEl('div',{id:'zip-import-panel', style:'padding:12px;border-top:1px solid rgba(255,255,255,0.04);background:transparent;'});

    const label = createEl('button',{id:'zipOpenBtn', className:'btn', style:'display:inline-block;padding:8px 12px;border-radius:8px;background:linear-gradient(90deg,var(--pink),var(--purple));color:white;border:none'}, ['Import .zip']);
    const input = createEl('input',{id:'zipInput', type:'file', accept:'.zip', style:'display:none'});
    const progress = createEl('div',{id:'zipProgress', style:'marginTop:8px;fontSize:'+'14px'}, ['']);
    const clearBtn = createEl('button',{id:'zipClear', className:'btn', style:'display:none;marginLeft:8px;padding:8px 12px;border-radius:8px'}, ['Clear imported cache']);

    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(clearBtn);
    panel.appendChild(progress);

    // insert at top of app or end
    app.insertBefore(panel, app.firstChild);
    return panel;
  }

  function setProgress(done, total, currentPath){
    const el = document.getElementById('zipProgress');
    if (!el) return;
    const pct = total ? Math.round((done/total)*100) : 0;
    el.textContent = `Importing ${done}/${total} (${pct}%) ${currentPath ? '- ' + currentPath : ''}`;
  }

  async function init(){
    const panel = ensureContainer();
    const input = panel.querySelector('#zipInput');
    const openBtn = panel.querySelector('#zipOpenBtn');
    const clearBtn = panel.querySelector('#zipClear');

    openBtn.addEventListener('click', ()=> input.click());

    input.addEventListener('change', async (e)=>{
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        setProgress(0,1);
        const res = await window.igZipImporter.importZipFile(f, setProgress);
        const el = document.getElementById('zipProgress');
        el.textContent = `Imported ${res.messageFiles.length} messages files — ${res.totalFiles} files processed.`;
        clearBtn.style.display = 'inline-block';
        // reload to allow app to read from IndexedDB
        setTimeout(()=>location.reload(), 800);
      } catch (err) {
        const el = document.getElementById('zipProgress');
        el.textContent = `Import failed: ${err && err.message ? err.message : err}`;
      }
    });

    clearBtn.addEventListener('click', async ()=>{
      if (!confirm('Clear all imported files from local cache?')) return;
      try {
        await window.igZipImporter.clearImportedFiles();
        document.getElementById('zipProgress').textContent = 'Imported cache cleared.';
        clearBtn.style.display = 'none';
        setTimeout(()=>location.reload(),500);
      } catch (err) {
        document.getElementById('zipProgress').textContent = `Failed to clear: ${err && err.message ? err.message : err}`;
      }
    });

    // show clear button if DB has imported files
    try {
      if (window.indexedDB) {
        const req = indexedDB.open('instagram-chat-viewer');
        req.onsuccess = function(){
          try {
            const db = req.result; if (db.objectStoreNames.contains('files')) {
              const tx = db.transaction('files','readonly');
              const store = tx.objectStore('files');
              const countReq = store.count();
              countReq.onsuccess = ()=>{ if (countReq.result>0) clearBtn.style.display='inline-block'; };
            }
          } catch(e){}
        };
      }
    } catch(e){}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
