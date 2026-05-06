const fs = require('fs');
const content = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Reelday — Share your moments</title>
<link rel="stylesheet" href="shared.css" />
<style>
  body { background: var(--paper); min-height: 100dvh; }
  .upload-shell { max-width: 480px; margin: 0 auto; padding: 20px 20px 96px; }
  .upload-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .upload-hero { text-align: center; padding: 24px 0 28px; border-bottom: 1px solid var(--line); margin-bottom: 24px; }
  .upload-hero h1 { font-family: var(--display); font-weight: 400; font-size: clamp(32px, 9vw, 52px); line-height: 1; letter-spacing: -.02em; margin-bottom: 6px; }
  .upload-hero h1 em { font-style: italic; color: var(--accent); }
  .upload-hero .meta { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
  .upload-hero .welcome { margin-top: 16px; font-family: var(--display); font-style: italic; font-size: 15px; color: var(--ink-soft); max-width: 32ch; margin-left: auto; margin-right: auto; line-height: 1.5; }
  .share-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
  .share-tab { background: #fff; border: 1.5px solid var(--line); border-radius: var(--r); padding: 14px 8px 12px; text-align: center; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .share-tab:hover { border-color: var(--accent); background: var(--paper-2); }
  .share-tab.active { border-color: var(--accent); background: var(--paper-2); }
  .share-tab.active .tab-icon { background: var(--accent); color: #fff; }
  .tab-icon { width: 40px; height: 40px; border-radius: 50%; background: var(--paper-3); color: var(--ink); display: flex; align-items: center; justify-content: center; }
  .tab-icon svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.8; }
  .tab-label { font-family: var(--mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); }
  .share-panel { display: none; }
  .share-panel.active { display: block; }
  .drop { background: #fff; border: 2px dashed var(--line-2); border-radius: var(--r-lg); padding: 36px 20px; text-align: center; cursor: pointer; }
  .drop:hover { border-color: var(--accent); background: var(--paper-2); transform: scale(1.01); }
  .drop input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .drop .icon { width: 60px; height: 60px; border-radius: 50%; background: var(--accent); color: #fff; margin: 0 auto 14px; display: flex; align-items: center; justify-content: center; font-size: 28px; }
  .drop h3 { font-family: var(--display); font-size: 20px; font-weight: 500; margin-bottom: 5px; color: var(--ink); }
  .drop p { color: var(--ink-soft); font-size: 13px; margin-bottom: 16px; }
  .drop .choose-btn { display: inline-block; background: var(--accent); color: #fff; border-radius: 999px; padding: 11px 22px; font-size: 14px; font-weight: 500; }
  .record-panel { background: #fff; border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; }
  .record-viewfinder { background: #1a0f0a; aspect-ratio: 16/10; position: relative; display: flex; align-items: center; justify-content: center; }
  .rec-dot { width: 8px; height: 8px; border-radius: 50%; background: #e63946; box-shadow: 0 0 0 3px rgba(230,57,70,.3); }
  .rec-dot.recording { animation: pulse 1s ease infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(230,57,70,0); } }
  .record-controls { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
  .rec-btn-row { display: flex; gap: 10px; align-items: center; justify-content: center; }
  .rec-btn-main { width: 64px; height: 64px; border-radius: 50%; background: #e63946; border: 3px solid #fff; box-shadow: 0 0 0 2px #e63946; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .rec-btn-main.recording { background: var(--ink); }
  .rec-status { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
  .rec-status.active { color: #e63946; }
  .clip-preview { background: var(--paper-2); border-radius: var(--r); padding: 12px; display: none; align-items: center; gap: 12px; }
  .clip-preview.visible { display: flex; }
  .message-panel { background: #fff; border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; }
  .mp-head { background: var(--paper-2); border-bottom: 1px solid var(--line); padding: 14px 18px; display: flex; align-items: center; gap: 10px; }
  .mp-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #2d7a4a; box-shadow: 0 0 0 3px rgba(45,122,74,.2); animation: glow 2s ease infinite; }
  @keyframes glow { 50% { box-shadow: 0 0 0 6px rgba(45,122,74,0); } }
  .mp-head-text { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
  .mp-body { padding: 18px; display: flex; flex-direction: column; gap: 14px; }
  .mp-attach-row { display: flex; gap: 8px; }
  .mp-attach-btn { flex: 1; background: var(--paper-2); border: 1px solid var(--line); border-radius: var(--r); padding: 10px 8px; cursor: pointer; }
  .mp-attach-btn:hover { border-color: var(--accent); background: var(--paper-3); }
  .mp-media-row { display: none; }
  .mp-media-row.visible { display: flex; }
  .mp-textarea-wrap { background: var(--paper); border: 1.5px solid var(--line); border-radius: var(--r); padding: 12px 14px; }
  .mp-textarea-wrap:focus-within { border-color: var(--accent); }
  .mp-textarea { width: 100%; border: none; outline: none; background: transparent; font-family: var(--display); font-size: 16px; font-style: italic; color: var(--ink); resize: none; }
  .mp-wall-preview { border-radius: var(--r); overflow: hidden; position: relative; aspect-ratio: 16/6; background: #1a0f0a; }
  .mp-char-count { font-family: var(--mono); font-size: 10px; color: var(--ink-faint); }
  .name-field { margin-top: 14px; background: #fff; border: 1px solid var(--line); border-radius: var(--r); padding: 12px 16px; }
  .name-field:focus-within { border-color: var(--accent); }
  .name-field label { font-family: var(--mono); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
  .name-field input { width: 100%; border: none; outline: none; font-size: 15px; background: transparent; color: var(--ink); }
  .queue { margin-top: 14px; display: grid; gap: 8px; }
  .queue-item { display: grid; grid-template-columns: 48px 1fr auto; gap: 10px; align-items: center; background: #fff; border: 1px solid var(--line); border-radius: var(--r); padding: 8px 12px; }
  .queue-item.done { border-color: rgba(45,122,74,.3); }
  .q-thumb { aspect-ratio: 1; border-radius: 6px; }
  .q-name { font-weight: 500; font-size: 13px; }
  .q-prog { height: 3px; background: var(--paper-3); border-radius: 2px; margin-top: 4px; overflow: hidden; }
  .q-prog span { display: block; height: 100%; background: var(--accent); }
  .q-status { font-family: var(--mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); }
  .queue-item.done .q-status { color: #2d7a4a; }
  .send-btn { width: 100%; padding: 15px; margin-top: 16px; font-size: 15px; }
  .success-banner { background: rgba(45,122,74,.08); border: 1px solid rgba(45,122,74,.25); border-radius: var(--r); padding: 16px 18px; margin-top: 14px; display: none; }
  .success-banner.visible { display: flex; }
  .success-banner .s-icon { font-size: 24px; color: #2d7a4a; }
  .success-banner b { font-family: var(--display); font-size: 17px; font-style: italic; color: var(--ink); }
  .success-banner span { font-size: 13px; color: var(--ink-soft); }
  .recent { margin-top: 48px; }
  .recent .recent-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .recent .recent-head h3 { font-family: var(--display); font-size: 17px; font-weight: 500; }
  .recent .recent-head .count { font-family: var(--mono); font-size: 10px; letter-spacing: .14em; color: var(--ink-soft); }
  .recent-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 5px; }
  .footer-note { text-align: center; margin-top: 48px; font-family: var(--mono); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); }
</style>
</head>
<body>
<div class="upload-shell">
  <div class="upload-top">
    <a class="brand" href="landing.html">REELDAY<sup>★</sup></a>
    <div class="lang-switch" id="langSwitch">
      <button class="active" onclick="setLang('EN',this)">EN</button>
      <button onclick="setLang('FIL',this)">FIL</button>
    </div>
  </div>
  <div class="upload-hero">
    <h1 id="heroName">Loading…</h1>
    <div class="meta" id="heroMeta">–</div>
    <div class="welcome" id="heroWelcome">–</div>
  </div>
  <div class="share-tabs">
    <div class="share-tab active" onclick="switchTab('gallery', this)">
      <div class="tab-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>
      <div class="tab-label">Photos<br/>& Videos</div>
    </div>
    <div class="share-tab" onclick="switchTab('record', this)">
      <div class="tab-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9" stroke-dasharray="3 2"/></svg></div>
      <div class="tab-label">Record<br/>Video</div>
    </div>
    <div class="share-tab" onclick="switchTab('message', this)">
      <div class="tab-icon"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <div class="tab-label">Live<br/>Message</div>
    </div>
  </div>
  <div class="share-panel active" id="panel-gallery">
    <div class="drop" id="dropZone">
      <input type="file" id="fileInput" multiple accept="image/*,video/*" onchange="handleFiles(event)" />
      <div class="icon">+</div>
      <h3>Tap to share</h3>
      <p>Photos and videos · up to 100 MB each</p>
      <div class="choose-btn">Choose from gallery</div>
    </div>
    <div class="name-field">
      <label>Your name (optional)</label>
      <input type="text" id="galleryName" placeholder="e.g. Tita Marivic, JM's cousin" />
    </div>
    <div class="queue" id="galleryQueue"></div>
    <button class="btn btn-primary send-btn" onclick="handleSend('gallery')">Send moments →</button>
    <div class="success-banner" id="gallerySuccess">
      <div class="s-icon">★</div>
      <div><b>Your moments are live!</b><span>They'll appear on the wall in a few seconds.</span></div>
    </div>
  </div>
  <div class="share-panel" id="panel-record">
    <div class="record-panel">
      <div class="record-viewfinder">
        <div class="vf-corners"></div>
        <div class="vf-dot-wrap">
          <div class="rec-dot" id="recDot"></div>
          <div class="vf-time" id="recTimeDisplay" style="display:none">00:00</div>
        </div>
        <div class="vf-label" id="vfLabel">Camera ready</div>
      </div>
      <div class="record-controls">
        <div class="rec-timer" id="recTimer">00:00</div>
        <div class="rec-btn-row">
          <button class="rec-btn-secondary" onclick="alert('TODO: flip camera')"><svg viewBox="0 0 24 24"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg></button>
          <button class="rec-btn-main" id="recBtn" onclick="toggleRecord()"><svg id="recIcon" viewBox="0 0 24 24" width="24" height="24" fill="white"><circle cx="12" cy="12" r="6"/></svg></button>
          <div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;"><span style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);text-align:center;line-height:1.3;">Max<br/>60s</span></div>
        </div>
        <div class="rec-status" id="recStatus">Tap to start recording</div>
        <div class="clip-preview" id="clipPreview"><div class="clip-thumb"></div><div class="clip-info"><div class="clip-name">recorded-clip.mp4</div><div class="clip-dur" id="clipDur">0:00</div></div><button class="clip-del" onclick="discardClip()">✕</button></div>
      </div>
    </div>
    <div class="name-field"><label>Your name (optional)</label><input type="text" id="recordName" placeholder="e.g. Tita Marivic" /></div>
    <button class="btn btn-primary send-btn" id="recordSendBtn" onclick="handleSend('record')" style="display:none;">Send video →</button>
    <div class="success-banner" id="recordSuccess"><div class="s-icon">★</div><div><b>Your video is live!</b><span>It'll appear on the wall in a few seconds.</span></div></div>
  </div>
  <div class="share-panel" id="panel-message">
    <div class="message-panel">
      <div class="mp-head"><div class="mp-live-dot"></div><div class="mp-head-text">Goes live on the wall instantly</div></div>
      <div class="mp-body">
        <div class="mp-attach-row">
          <button class="mp-attach-btn" onclick="alert('TODO: open photo picker')"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>Add photo</span></button>
          <button class="mp-attach-btn" onclick="alert('TODO: open video picker')"><svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg><span>Add video</span></button>
          <button class="mp-attach-btn" onclick="showAttached()"><svg viewBox="0 0 24 24"><path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z"/><path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/><path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z"/><path d="M3.5 14H5v1.5c0 .83-.67 1.5 1.5 1.5S8 16.33 8 15.5 7.33 14 6.5 14H3.5z"/><path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z"/><path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"/><path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z"/><path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2H3.5C2.67 2 2 2.67 2 3.5V5H8.5z"/></svg><span>GIF / sticker</span></button>
        </div>
        <div class="mp-media-row" id="mpMediaRow"><div class="mp-media-thumb"><button class="mp-media-del" onclick="document.getElementById('mpMediaRow').classList.remove('visible')">✕</button></div></div>
        <div class="mp-textarea-wrap"><label>Your message</label><textarea class="mp-textarea" id="msgText" maxlength="160" placeholder="Write something for the wall…" oninput="updateMsgPreview()"></textarea></div>
        <div class="mp-char-count" id="charCount">0 / 160</div>
        <div class="mp-wall-preview"><div class="mp-wall-bg"></div><div class="mp-wall-vignette"></div><div class="mp-wall-label">Preview · how it looks on wall</div><div class="mp-wall-msg"><div class="mp-wall-msg-from" id="msgFrom">— Your name</div><div id="msgPreview" style="opacity:.4;font-style:italic;">Your message appears here…</div></div></div>
      </div>
    </div>
    <div class="name-field"><label>Your name (optional)</label><input type="text" id="msgName" placeholder="e.g. Tita Marivic" oninput="document.getElementById('msgFrom').textContent = '— ' + (this.value || 'Your name')" /></div>
    <button class="btn btn-accent send-btn" onclick="handleSend('message')">Send to wall →</button>
    <div class="success-banner" id="messageSuccess"><div class="s-icon">★</div><div><b>Your message is live!</b><span>It's on the wall right now.</span></div></div>
  </div>
  <div class="recent"><div class="recent-head"><h3>Recently shared</h3><span class="count" id="recentCount">0 today</span></div><div class="recent-grid" id="recentGrid"></div></div>
  <div class="footer-note">★ Powered by Reelday · reelday.ph</div>
</div>
<script>
  async function loadEvent() {
    const params = new URLSearchParams(location.search);
    const slug = params.get('slug') || 'andrea-jm';
    try {
      const res = await fetch('/api/uploads/' + slug);
      if (!res.ok) throw new Error('Event not found');
      const data = await res.json();
      populateEvent(data);
    } catch (err) {
      console.error(err);
      document.getElementById('heroName').textContent = 'Event not found';
    }
  }
  function populateEvent(data) {
    const event = data.event;
    const uploads = data.uploads || [];
    document.getElementById('heroName').textContent = event.couple_names || 'Unknown';
    const date = new Date(event.event_date);
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    const formattedDate = date.toLocaleDateString('en-PH', options);
    document.getElementById('heroMeta').textContent = formattedDate + ' · ' + (event.venue || 'Location');
    document.getElementById('heroWelcome').textContent = event.welcome_message || 'Salamat sa pagdating!';
    document.getElementById('recentCount').textContent = uploads.length + ' today';
    const grid = document.getElementById('recentGrid');
    grid.innerHTML = '';
    for (let i = 0; i < Math.min(uploads.length, 9); i++) {
      const div = document.createElement('div');
      div.className = 'placeholder placeholder--coral';
      div.style.background = ['#e8c5b0','#c45a3a','#f5c9a8','#d4a574','#e0c9b0'][i % 5];
      grid.appendChild(div);
    }
    while (grid.children.length < 9) {
      const div = document.createElement('div');
      div.className = 'placeholder placeholder--paper';
      grid.appendChild(div);
    }
  }
  function switchTab(id, el) {
    document.querySelectorAll('.share-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.share-panel').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('panel-' + id).classList.add('active');
  }
  function setLang(lang, btn) {
    document.querySelectorAll('#langSwitch button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  function handleFiles(e) {
    const files = Array.from(e.target.files);
    const queue = document.getElementById('galleryQueue');
    files.forEach(f => {
      const id = 'qi' + Date.now() + Math.random().toString(36).slice(2,6);
      const item = document.createElement('div');
      item.className = 'queue-item'; item.id = id;
      item.innerHTML = '<div class="q-thumb placeholder placeholder--coral"></div><div><div class="q-name">' + f.name + '</div><div class="q-prog"><div id="b'+id+'" style="width:0%;height:100%;background:var(--accent);border-radius:2px;"></div></div></div><div class="q-status" id="s'+id+'">Queued</div>';
      queue.appendChild(item);
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
    document.querySelector('#panel-gallery .send-btn').textContent = 'Send ' + files.length + ' moment' + (files.length>1?'s':'') + ' →';
  }
  let recording = false, recInterval, recSecs = 0;
  function toggleRecord() {
    const btn = document.getElementById('recBtn');
    const dot = document.getElementById('recDot');
    const status = document.getElementById('recStatus');
    const timer = document.getElementById('recTimer');
    const lbl = document.getElementById('vfLabel');
    const icon = document.getElementById('recIcon');
    const sendBtn = document.getElementById('recordSendBtn');
    if (!recording) {
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
        if (recSecs >= 60) stopRecord();
      }, 1000);
    } else { stopRecord(); }
  }
  function stopRecord() {
    recording = false; clearInterval(recInterval);
    const btn = document.getElementById('recBtn');
    const dot = document.getElementById('recDot');
    const status = document.getElementById('recStatus');
    const lbl = document.getElementById('vfLabel');
    const preview = document.getElementById('clipPreview');
    const dur = document.getElementById('clipDur');
    const sendBtn = document.getElementById('recordSendBtn');
    btn.classList.remove('recording');
    dot.classList.remove('recording');
    icon.innerHTML = '<circle cx="12" cy="12" r="6"/>';
    status.textContent = 'Recording saved'; status.classList.remove('active');
    lbl.textContent = 'Camera ready';
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
  function handleSend(mode) {
    const successId = {'gallery': 'gallerySuccess', 'record': 'recordSuccess', 'message': 'messageSuccess'}[mode];
    document.getElementById(successId).classList.add('visible');
    const el = document.getElementById('recentCount');
    const n = parseInt(el.textContent, 10);
    el.textContent = (n + 1) + ' today';
  }
  document.addEventListener('DOMContentLoaded', loadEvent);
</script>
</body>
</html>`;
fs.writeFileSync('frontend/upload.html', content);
console.log('File written successfully');