(() => {
  const POLL_INTERVAL_MS = 8000;

  const els = {
    userInfo: document.getElementById('userInfo'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('artifact'),
    fileName: document.getElementById('fileName'),
    versionAction: document.getElementById('versionAction'),
    manualVersion: document.getElementById('manualVersion'),
    form: document.getElementById('uploadForm'),
    status: document.getElementById('status'),
    submitBtn: document.getElementById('submitBtn'),
  };

  let pollTimer = null;

  function setStatus(kind, html) {
    els.status.className = 'status ' + kind;
    els.status.innerHTML = html;
  }

  function resetButton() {
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = 'Upload & trigger pipeline';
  }

  // --- Auth: show signed-in user --------------------------------------------
  async function loadUser() {
    try {
      const r = await fetch('/api/me');
      const user = r.ok ? await r.json() : null;
      els.userInfo.innerHTML = user
        ? `Signed in as <strong>${user.name}</strong> &middot; <a href="/auth/logout">Sign out</a>`
        : `<a href="/auth/login">Sign in</a>`;
    } catch {
      els.userInfo.innerHTML = `<a href="/auth/login">Sign in</a>`;
    }
  }

  // --- Drop zone behavior ---------------------------------------------------
  function initDropZone() {
    ['dragenter', 'dragover'].forEach(ev =>
      els.dropZone.addEventListener(ev, e => {
        e.preventDefault();
        els.dropZone.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach(ev =>
      els.dropZone.addEventListener(ev, e => {
        e.preventDefault();
        els.dropZone.classList.remove('dragover');
      })
    );
    els.dropZone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length) {
        els.fileInput.files = e.dataTransfer.files;
        showFileName();
      }
    });
    els.fileInput.addEventListener('change', showFileName);
  }

  function showFileName() {
    const f = els.fileInput.files[0];
    if (!f) return;
    els.fileName.style.display = 'inline-flex';
    els.fileName.textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
  }

  // --- Version action toggle ------------------------------------------------
  function initVersionAction() {
    els.versionAction.addEventListener('change', () => {
      els.manualVersion.disabled = els.versionAction.value !== 'manual';
      if (els.manualVersion.disabled) els.manualVersion.value = '';
    });
  }

  // --- Pipeline run polling -------------------------------------------------
  async function pollRun(buildId, runUrl) {
    try {
      const r = await fetch(`/api/runs/${buildId}/status`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Status check failed');

      const runLink = runUrl
        ? ` <a href="${runUrl}" target="_blank">View run #${buildId} &rarr;</a>`
        : '';

      if (data.status !== 'completed') {
        setStatus('info', `<span class="spinner"></span> Pipeline ${data.status}&hellip;${runLink}`);
        pollTimer = setTimeout(() => pollRun(buildId, runUrl), POLL_INTERVAL_MS);
        return;
      }

      if (data.result === 'succeeded') {
        setStatus(
          'success',
          `Pipeline succeeded. <a href="/api/runs/${buildId}/download" download>Download signed IPA &darr;</a>${runLink}`
        );
      } else {
        setStatus('error', `Pipeline ended with result: <strong>${data.result}</strong>.${runLink}`);
      }
      resetButton();
    } catch (err) {
      setStatus('error', 'Status check failed: ' + err.message);
      resetButton();
    }
  }

  // --- Form submission ------------------------------------------------------
  function initForm() {
    els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }

      els.submitBtn.disabled = true;
      els.submitBtn.innerHTML = '<span class="spinner"></span> Uploading&hellip;';
      setStatus('info', 'Uploading&hellip; this may take a few minutes for large files.');

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: new FormData(els.form),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
        }

        const buildId = data.run?.id;
        const runUrl = data.run?.url;
        if (!buildId) throw new Error('No run id returned from pipeline trigger');

        setStatus('info', `<span class="spinner"></span> Upload complete. Waiting for pipeline&hellip;`);
        els.form.reset();
        els.fileName.style.display = 'none';
        els.manualVersion.disabled = true;
        pollRun(buildId, runUrl);
      } catch (err) {
        setStatus('error', 'Error: ' + err.message);
        resetButton();
      }
    });
  }

  // --- Init -----------------------------------------------------------------
  loadUser();
  initDropZone();
  initVersionAction();
  initForm();
})();
