const fs = require('fs');
let content = fs.readFileSync('frontend/upload.html', 'utf8');
let lines = content.split('\n');

// Find and modify the hero section lines
for (let i = 0; i < lines.length; i++) {
  // Update hero section
  if (lines[i].includes('<!-- TODO: populate from GET /api/events/:slug -->')) {
    lines[i] = '   <!-- Event hero -->';
  }
  if (lines[i].includes('<h1 id="heroName">Andrea <em>&</em> JM</h1>')) {
    lines[i] = '     <h1 id="heroName">Loading…</h1>';
  }
  if (lines[i].includes('<div class="meta">14 June 2026 · Manila Hotel</div>')) {
    lines[i] = '     <div class="meta" id="heroMeta">–</div>';
  }
  if (lines[i].includes('<div class="welcome">"Salamat sa pagdating! Scan, share, and become part of the story."</div>')) {
    lines[i] = '     <div class="welcome" id="heroWelcome">–</div>';
  }
  // Update recent count
  if (lines[i].includes('<span class="count" id="recentCount">847 today</span>')) {
    lines[i] = '       <span class="count" id="recentCount">–</span>';
  }
}

content = lines.join('\n');

// Add API functions before </body>
const apiFunctions = `
<script>
  /* ── API base URL ───────────────────────────────────── */
  const API_BASE = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : '';

  /* ── Extract slug from URL ───────────────────────────── */
  function getSlug() {
    const url = new URL(window.location.href);
    return url.searchParams.get('slug') || 'demo-wedding';
  }

  /* ── Load event data from API ────────────────────────── */
  async function loadEvent() {
    const slug = getSlug();
    try {
      const response = await fetch(\`\${API_BASE}/api/uploads/\${slug}\`);
      if (!response.ok) throw new Error('Event not found');
      const data = await response.json();
      populateEvent(data.event, data.uploads.length);
    } catch (err) {
      console.error('Failed to load event:', err);
      document.getElementById('heroName').textContent = 'Event not found';
    }
  }

  /* ── Populate UI with event data ─────────────────────── */
  function populateEvent(event, uploadCount) {
    // Hero section
    document.getElementById('heroName').textContent = event.couple_names || 'Unknown Event';
    
    // Format date: YYYY-MM-DD -> "DD Month YYYY"
    if (event.event_date) {
      const date = new Date(event.event_date);
      const options = { day: 'numeric', month: 'long', year: 'numeric' };
      document.getElementById('heroMeta').textContent = date.toLocaleDateString('en-PH', options);
    }
    
    // Welcome message (default if not provided)
    document.getElementById('heroWelcome').textContent = event.welcome_message || 'Salamat sa pagdating! Scan, share, and become part of the story.';
    
    // Recent count
    document.getElementById('recentCount').textContent = uploadCount + ' today';
  }

  /* ── Tab switching ─────────────────────────────────── */
  function switchTab(id, el) {
    document.querySelectorAll('.share-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.share-panel').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('panel-' + id).classList.add('active');
  }

  /* ── Language ──────────────────────────────────────── */
  function setLang(lang, btn) {
    document.querySelectorAll('#langSwitch button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // TODO: swap UI copy via i18n
  }

  /* ── Gallery: file input ───────────────────────────── */
  function handleFiles(e) {
    const files = Array.from(e.target.files);
    const queue = document.getElementById('galleryQueue');
    files.forEach(f => {
      const id = 'qi' + Date.now() + Math.random().toString(36).slice(2,6);
      const item = document.createElement('div');
      item.className = 'queue-item'; item.id = id;
      item.innerHTML = \`
        <div class="q-thumb placeholder placeholder--coral"></div>
        <div><div class="q-name">\${f.name}</div><div class="q-prog"><div id="b\${id}" style="width:0%;height:100%;background:var(--accent);border-radius:2px;"></div></div></div>
        <div class="q-status" id="s\${id}">Queued</div>\`;
      queue.appendChild(item);
      // simulate progress — TODO replace with real XHR
      let p = 0;
      const t = setInterval(() => {
        p = Math.min(p + Math.random()*18+5, 100);
        const b = document.getElementById('b'+id);
        const s = document.getElementById('s'+id);
        if (b) b.style.width = p+'%';
        if (s) s.textContent = p < 100 ? Math.round(p)+'%' : '✓ Shared';
        if (p >= 100) { clearInterval(t); item.classList.add('done'); }
      }, 200);
    });
    // update button
    const pending = document.querySelectorAll('#galleryQueue .queue-item:not(.done)').length;
    document.querySelector('#panel-gallery .send-btn').textContent = \`Send \${files.length} moment\${files.length>1?'s':''} →\`;
  }

  /* ── Gallery: simulate demo bar ───────────────────── */
  (function() {
    const bar = document.getElementById('demoBar1');
    const pct = document.getElementById('demoPct1');
    if (!bar) return;
    let p = 62;
    const t = setInterval(() => {
      p = Math.min(p + Math.random()*10+4, 100);
      bar.style.width = p+'%';
      if (pct) pct.textContent = p < 100 ? Math.round(p)+'%' : '✓ Shared';
      const item = bar.closest('.queue-item');
      if (p >= 100) { clearInterval(t); if (item) item.classList.add('done'); }
    }, 280);
  })();

  /* ── Record video ──────────────────────────────────── */
  let recording = false, recInterval, recSecs = 0;

  function toggleRecord() {
    const btn    = document.getElementById('recBtn');
    const dot    = document.getElementById('recDot');
    const status = document.getElementById('recStatus');
    const timer  = document.getElementById('recTimer');
    const lbl    = document.getElementById('vfLabel');
    const icon   = document.getElementById('recIcon');
    const sendBtn = document.getElementById('recordSendBtn');

    if (!recording) {
      // Start recording
      /* TODO: real camera:
         const stream = await navigator.mediaDevices.getUserMedia({video:true,audio:true});
         const mr = new MediaRecorder(stream);
         mr.start(); mr.ondataavailable = e => chunks.push(e.data);
         mr.onstop = () => { const blob = new Blob(chunks); handleRecordedBlob(blob); };
      */
      recording = true; recSecs = 0;
      btn.classList.add('recording');
      dot.classList.add('recording');
      icon.innerHTML = '<rect x="8" y="8" width="8" height="8" rx="1" fill="white"/>';
      status.textContent = 'Recording…'; status.classList.add('active');
      lbl.textContent = '● REC';
      timer.classList.add('visible');
      recInterval = setInterval(() => {
        recSecs++;
        const m = String(Math.floor(recSecs/60)).padStart(2,'0');
        const s = String(recSecs%60).padStart(2,'0');
        timer.textContent = m+':'+s;
        if (recSecs >= 60) stopRecord(); // max 60s
      }, 1000);
    } else {
      stopRecord();
    }
  }

  function stopRecord() {
    recording = false; clearInterval(recInterval);
    const btn    = document.getElementById('recBtn');
    const dot    = document.getElementById('recDot');
    const status = document.getElementById('recStatus');
    const lbl    = document.getElementById('vfLabel');
    const icon   = document.getElementById('recIcon');
    const preview = document.getElementById('clipPreview');
    const dur    = document.getElementById('clipDur');
    const sendBtn = document.getElementById('recordSendBtn');

    btn.classList.remove('recording');
    dot.classList.remove('recording');
    icon.innerHTML = '<circle cx="12" cy="12" r="6"/>';
    status.textContent = 'Recording saved'; status.classList.remove('active');
    lbl.textContent = 'Camera ready';

    // Show clip preview
    const m = String(Math.floor(recSecs/60)).padStart(2,'0');
    const s = String(recSecs%60).padStart(2,'0');
    dur.textContent = m+':'+s;
    preview.classList.add('visible');
    sendBtn.style.display = 'block';
  }

  function discardClip() {
    document.getElementById('clipPreview').classList.remove('visible');
    document.getElementById('recordSendBtn').style.display = 'none';
    document.getElementById('recTimer').classList.remove('visible');
    document.getElementById('recTimer').textContent = '00:00';
    document.getElementById('recStatus').textContent = 'Tap to start recording';
  }

  /* ── Live message ──────────────────────────────────── */
  function updateMsgPreview() {
    const txt = document.getElementById('msgText').value;
    const preview = document.getElementById('msgPreview');
    const counter = document.getElementById('charCount');
    preview.textContent = txt || 'Your message appears here…';
    preview.style.opacity = txt ? '1' : '0.4';
    counter.textContent = txt.length + ' / 160';
    counter.classList.toggle('warn', txt.length > 140);
  }

  function showAttached() {
    document.getElementById('mpMediaRow').classList.add('visible');
  }

  /* ── Send handler (all modes) ──────────────────────── */
  function handleSend(mode) {
    /* TODO: POST to /api/events/:slug/upload for gallery+record
             POST to /api/events/:slug/message for live message */
    const successId = { gallery: 'gallerySuccess', record: 'recordSuccess', message: 'messageSuccess' }[mode];
    document.getElementById(successId).classList.add('visible');
    // bump recent count
    const el = document.getElementById('recentCount');
    const n  = parseInt(el.textContent, 10);
    el.textContent = (n + 1) + ' today';
  }

  /* ── Init: load event on page load ──────────────────── */
  document.addEventListener('DOMContentLoaded', loadEvent);
</script>
`;

// Find the position of </body> and insert the script before it
const bodyEnd = content.indexOf('</body>');
if (bodyEnd !== -1) {
  content = content.slice(0, bodyEnd) + apiFunctions + content.slice(bodyEnd);
}

fs.writeFileSync('frontend/upload.html', content);
console.log('File updated successfully');