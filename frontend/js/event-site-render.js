(function () {
  "use strict";

  // Stable guest identity — same key as the upload page so an RSVP
  // dedupes with the same person's prior uploads, and so the rate
  // limiter buckets them as one client.
  function guestId() {
    try {
      var id = localStorage.getItem('reelday_guest_id');
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) ||
             (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        localStorage.setItem('reelday_guest_id', id);
      }
      return id;
    } catch (e) {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
  }
  var GUEST_ID = guestId();

  // Set at the top of each render() call — lets the same shared module
  // serve both the real guest page (real slug, live api()) and the
  // website-builder preview (no slug yet, api() a no-op).
  var ACTIVE_SLUG = '';
  var PREVIEW_MODE = false;

  // UI labels (English-only). Host-supplied content is never translated.
  var L = {
    story:'Our Story', details:'The Details', when:'When',
    gallery:'Gallery', seat:'Find Your Seat', seatHint:'Type your full name',
    seatBtn:'Find my table', rsvp:'RSVP', faq:'Questions',
    entourage:'The Entourage', goodToKnow:'Good to Know',
    attending:'Joyfully accepts', notAttending:'Regretfully declines',
    party:'Number in your party', message:'A note (optional)',
    send:'Send RSVP', sent:'Thank you! Your RSVP is saved.',
    noSeat:'We couldn’t find that name. Try your first name or last name on its own, or check with the host if the seating list isn’t set up yet.',
    table:'Table', addCal:'Add to calendar', share:'Share',
    upload:'Share your photos', happening:'Happening now',
    openWall:'Open the live wall', nameLbl:'Your full name',
    emailLbl:'Your email (optional — we’ll send a confirmation)',
    noteHint:'Song request, dietary notes, or a message (optional)',
    rsvpBy:'Please RSVP by',
    rsvpClosed:'RSVPs are closed',
    rsvpClosedSub:'The deadline has passed — please contact the host directly.',
    registry:'With Love',
    eyebrowRegistry:'— if you wish to bless us —',
    tapCopy:'Tap to copy',
    copied:'Copied',
    openLink:'Open',
    days:'days', hrs:'hrs', min:'min', sec:'sec',
    scroll:'Scroll', mapsLink:'Open in Maps',
    eyebrowStory:'— in their own words —',
    eyebrowDetails:'— the day, hour by hour —',
    eyebrowGallery:'— moments, captured —',
    eyebrowSeat:'— your place at the table —',
    eyebrowRsvp:'— we hope you can come —',
    eyebrowFaq:'— things to know —',
    eyebrowEntourage:'— with us in the celebration —',
    eyebrowFootInvite:'— we can’t wait —',
    footTitle:'Save the date.',
    memoryAlbum:'Memory Album',
    eyebrowMemoryAlbum:'— every smile, every laugh —',
    memoryAlbumPreMsg:'Photos and videos from our celebration will appear here after the event. Check back after the celebration to relive every memory.',
    memoryAlbumLiveMsg:'The celebration is happening — add your photos and videos to our shared album.',
    memoryAlbumCountMsg:'{count} memories shared so far — add yours to the album.'
  };
  function t(k) { return L[k] || k; }

  // ── Safe DOM builders (host text via textContent only) ──
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function section(id, eyebrow, title, body) {
    var s = el('section', { class: 'es-section', id: id });
    if (eyebrow) s.appendChild(el('div', { class: 'es-eyebrow', text: eyebrow }));
    if (title)   s.appendChild(el('h2',  { class: 'es-heading', text: title }));
    if (body)    s.appendChild(body);
    return s;
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-PH',
        { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) { return String(d); }
  }

  function api(path, opts) {
    if (PREVIEW_MODE) {
      // No network calls from the anonymous builder preview — resolve
      // to a "not ok" response so seat-lookup/RSVP handlers no-op safely.
      return Promise.resolve({ ok: false, status: 0, json: function () { return Promise.resolve({}); } });
    }
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Guest-Id': GUEST_ID }, opts.headers || {});
    return fetch('/api/event-site/' + encodeURIComponent(ACTIVE_SLUG) + path, opts);
  }

  // ── Image CDN transform ───────────────────────────
  // Pipe any Reelday-hosted R2 image through Cloudflare's free
  // /cdn-cgi/image/ transform so guests get a WebP/AVIF variant
  // sized for their viewport instead of the 1.9 MB original PNG.
  // Same pattern the dashboard and wall use (dashboard.html:2120).
  // format=auto returns WebP/AVIF per the visitor's Accept header.
  function cdnImage(url, width) {
    if (!url) return url;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (/\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(url)) return url;
    try {
      var u = new URL(url, location.href);
      if (!/(^|\.)reelday\.ph$/.test(u.hostname)) return url;
      if (u.pathname.indexOf('/cdn-cgi/image/') === 0) return url;
      var opts = 'width=' + width + ',quality=82,format=auto,fit=scale-down';
      return u.origin + '/cdn-cgi/image/' + opts + u.pathname + u.search;
    } catch (e) { return url; }
  }
  // Build a responsive srcset string for an R2 image.
  function cdnSrcset(url, widths) {
    if (!url) return '';
    return widths.map(function (w) {
      return cdnImage(url, w) + ' ' + w + 'w';
    }).join(', ');
  }

  // Render couple names with the ampersand styled separately.
  // Real space text nodes (not just the .amp span's CSS padding) around
  // the ampersand -- without them "Amara" + <span>&</span> + "Diego" is
  // one unbroken run with no whitespace anywhere in it, so on a narrow
  // width overflow-wrap:break-word (needed so a single very long name
  // doesn't overflow the frame) had nowhere valid to break and instead
  // split a name itself mid-word, e.g. "Di" / "ego".
  function buildCoupleNode(name) {
    var frag = document.createDocumentFragment();
    var parts = String(name || '—').split(/\s*&\s*/);
    parts.forEach(function (p, i) {
      if (i > 0) {
        frag.appendChild(document.createTextNode(' '));
        var amp = el('span', { class: 'amp', text: '&' });
        frag.appendChild(amp);
        frag.appendChild(document.createTextNode(' '));
      }
      frag.appendChild(document.createTextNode(p));
    });
    return frag;
  }

  // ─────────────────────────────────────────────────────
  // Tolerant schedule parser.
  //
  // The wizard previously took every textarea line as its own row,
  // so an event saved as
  //   2:30 PM
  //   Guest Arrival
  //   Welcome drinks & seating
  // became three {time, label:''} rows. Detect that pattern (all
  // labels empty AND row count divisible by 2 or 3) and reshape it.
  // Otherwise treat rows as already-correct {time, label} pairs.
  // Output: array of { time, title, sub }.
  // ─────────────────────────────────────────────────────
  function parseSchedule(raw) {
    if (!Array.isArray(raw) || !raw.length) return [];

    var looksWell = raw.some(function (r) { return r && r.label && String(r.label).trim(); });
    if (looksWell) {
      return raw.filter(function (r) { return r && (r.time || r.label); })
        .map(function (r) { return { time: String(r.time || '').trim(), title: String(r.label || '').trim(), sub: '' }; });
    }

    // Flatten to ordered non-empty strings.
    var flat = [];
    raw.forEach(function (r) {
      if (r && r.time && String(r.time).trim()) flat.push(String(r.time).trim());
      if (r && r.label && String(r.label).trim()) flat.push(String(r.label).trim());
    });
    if (!flat.length) return [];

    // Heuristic: any token that starts with a number+colon or contains "AM/PM"
    // is a time stamp. Walk the list; each time stamp opens a new entry, the
    // next 0–2 non-time tokens are its title and subtitle.
    var TIME_RE = /^\s*(\d{1,2}(:\d{2})?\s*(am|pm|AM|PM))|^\s*(\d{1,2}:\d{2})\b/;
    var out = [];
    var cur = null;
    flat.forEach(function (tok) {
      if (TIME_RE.test(tok)) {
        if (cur) out.push(cur);
        cur = { time: tok, title: '', sub: '' };
      } else if (cur) {
        if (!cur.title) cur.title = tok;
        else if (!cur.sub) cur.sub = tok;
        else cur.sub += ' · ' + tok;
      } else {
        // No leading time — emit as a title-only entry.
        out.push({ time: '', title: tok, sub: '' });
      }
    });
    if (cur) out.push(cur);
    return out;
  }

  // ─────────────────────────────────────────────────────
  // Good-to-know parser. Hosts write blocks like:
  //   Arrival Time || Please arrive 30 minutes early.
  //
  //   Venue Address || The Manila Hotel, Manila.
  // Split into items on blank lines, then split each on `||`.
  // ─────────────────────────────────────────────────────
  function parseGoodToKnow(raw) {
    if (!raw || typeof raw !== 'string') return [];
    var blocks = String(raw).split(/\n\s*\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    return blocks.map(function (b) {
      var i = b.indexOf('||');
      if (i === -1) return { title: '', body: b };
      return {
        title: b.slice(0, i).trim(),
        body:  b.slice(i + 2).trim(),
      };
    });
  }

  // ─────────────────────────────────────────────────────
  // Nearby stays — deep links into the major booking sites
  // pre-filtered to the venue. No API: we just hand them the
  // search query (the venue name or address) and let the
  // booking site render its real inventory. Works for any
  // venue worldwide; no host configuration required.
  // ─────────────────────────────────────────────────────
  function buildNearbyStays(displayName, query) {
    var q = String(query || displayName || '').trim();
    if (!q) return document.createDocumentFragment();
    var enc = encodeURIComponent(q);
    var sites = [
      { brand: 'booking', name: 'Booking.com',
        url: 'https://www.booking.com/searchresults.html?ss=' + enc, mark: 'B' },
      { brand: 'agoda',   name: 'Agoda',
        url: 'https://www.agoda.com/search?textToSearch=' + enc, mark: 'A' },
      { brand: 'google',  name: 'Google Hotels',
        url: 'https://www.google.com/travel/hotels?q=' + enc, mark: 'G' },
    ];
    var wrap = el('div', { class: 'es-stays' });
    wrap.appendChild(el('div', { class: 'es-stays-title',
      text: '— Nearby stays —' }));
    var list = el('div', { class: 'es-stays-list' });
    sites.forEach(function (s) {
      var a = el('a', { class: 'es-stay', href: s.url,
        target: '_blank', rel: 'noopener noreferrer' });
      a.appendChild(el('div', { class: 'brand ' + s.brand, text: s.mark }));
      var body = el('div', { class: 'body' });
      body.appendChild(el('div', { class: 'name', text: s.name }));
      body.appendChild(el('div', { class: 'sub',  text: 'Stays near ' + displayName }));
      a.appendChild(body);
      a.appendChild(el('div', { class: 'chev', text: '→' }));
      list.appendChild(a);
    });
    wrap.appendChild(list);
    return wrap;
  }

  // ── render ──
  // container defaults to the real page's #app; opts = { preview, slug }.
  // opts.preview gates every side effect that would otherwise reach
  // outside `container` (document.body mutations, the countdown
  // interval, and any real network call) — see the CONTEXT comment in
  // event-site.html for why this function is shared with the
  // anonymous website-builder preview instead of duplicated.
  function render(data, container, opts) {
    opts = opts || {};
    PREVIEW_MODE = !!opts.preview;
    ACTIVE_SLUG = opts.slug || '';

    var cfg = data.config || {};
    var app = container || document.getElementById('app');
    app.textContent = '';
    // data-theme is the event-TYPE palette (wedding/debut/birthday/...,
    // defined in shared.css). data-template is a second, independent
    // dimension -- the host-chosen aesthetic preset for the invitation
    // itself (defined in event-site.css); "classic" needs no override
    // block since it's just whatever data-theme already provides.
    if (PREVIEW_MODE) {
      app.setAttribute('data-theme', data.theme || 'wedding');
      app.setAttribute('data-template', cfg.template || 'classic');
    } else {
      document.documentElement.setAttribute('data-theme', data.theme || 'wedding');
      document.documentElement.setAttribute('data-template', cfg.template || 'classic');
    }

    // Nav structure — on desktop the chip row carries the links;
     // on mobile a hamburger opens the full-screen sheet built
     // below. Both lists are populated by addNav() so they stay
     // in sync no matter which sections the host enabled.
     var nav = el('nav', { class: 'es-nav', id: 'esNav' });
     var navBrand = el('div', { class: 'es-nav-brand', text: data.couple_names || '' });
     var navInline = el('div', { class: 'es-nav-inline' });
     var burger = el('button', { class: 'es-burger', type: 'button',
       'aria-label': 'Open menu', 'aria-controls': 'esMenu', 'aria-expanded': 'false' });
     burger.innerHTML =
       '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
       '<path d="M4 7h16M4 12h16M4 17h16"/></svg>';
     nav.appendChild(navBrand);
     nav.appendChild(navInline);
     nav.appendChild(burger);

     // Full-screen mobile menu sheet
     var menu = el('div', { class: 'es-menu', id: 'esMenu', 'aria-hidden': 'true' });
     var menuHead = el('div', { class: 'es-menu-head' });
     menuHead.appendChild(el('div', { class: 'es-menu-eyebrow', text: 'Menu' }));
     var menuClose = el('button', { class: 'es-menu-close', type: 'button',
       'aria-label': 'Close menu' });
     menuClose.innerHTML =
       '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
       '<path d="M6 6l12 12M18 6l-12 12"/></svg>';
     menuHead.appendChild(menuClose);
     menu.appendChild(menuHead);
     var menuList = el('div', { class: 'es-menu-list' });
     menu.appendChild(menuList);
     menu.appendChild(el('div', { class: 'es-menu-foot', text: 'reelday.ph' }));

     function openMenu() {
       menu.classList.add('open');
       menu.setAttribute('aria-hidden', 'false');
       burger.setAttribute('aria-expanded', 'true');
       if (!PREVIEW_MODE) document.body.classList.add('menu-open');
     }
     function closeMenu() {
       menu.classList.remove('open');
       menu.setAttribute('aria-hidden', 'true');
       burger.setAttribute('aria-expanded', 'false');
       if (!PREVIEW_MODE) document.body.classList.remove('menu-open');
     }
     burger.addEventListener('click', openMenu);
     menuClose.addEventListener('click', closeMenu);
     document.addEventListener('keydown', function (e) {
       if (e.key === 'Escape' && menu.classList.contains('open')) closeMenu();
     });

     function addNav(id, label) {
       navInline.appendChild(el('a', { href: '#' + id, text: label }));
       var row = el('a', { href: '#' + id });
       row.appendChild(el('span', { class: 'lbl', text: label }));
       row.appendChild(el('span', { class: 'arr', text: '→' }));
       row.addEventListener('click', closeMenu);
       menuList.appendChild(row);
     }

    // ── Hero ────────────────────────────────────────
    var hero = el('section', { class: 'es-hero' });
    if (data.cover_photo_url) {
      // Real <img> with srcset + fetchpriority — the browser picks
      // a viewport-appropriate variant (WebP/AVIF on Chromium/Safari
      // via Cloudflare's format=auto) so guests pull ~80–300 KB
      // instead of the raw 1.9 MB PNG, and the request fires at high
      // priority before gallery images compete for bandwidth.
      var bg = el('img', {
        class: 'es-hero-bg',
        alt: '',
        'aria-hidden': 'true',
        src: cdnImage(data.cover_photo_url, 1600),
        srcset: cdnSrcset(data.cover_photo_url, [640, 960, 1280, 1600, 2000]),
        sizes: '100vw',
        decoding: 'async',
        fetchpriority: 'high'
      });
      bg.addEventListener('load', function () { bg.classList.add('loaded'); });
      // Fallback to the original if the CDN transform errors for any
      // reason (e.g. an external cover URL the transform can't reach).
      bg.addEventListener('error', function () {
        if (bg.src !== data.cover_photo_url) {
          bg.removeAttribute('srcset');
          bg.src = data.cover_photo_url;
        }
      });
      hero.appendChild(bg);
    } else {
      hero.classList.add('no-bg');
    }

    var heroTop = el('div', { class: 'es-hero-top' });
    var lockup = el('div', { class: 'es-hero-lockup' });
    var h1 = el('h1', { class: 'es-hero-names' });
    h1.appendChild(buildCoupleNode(data.couple_names));
    lockup.appendChild(h1);
    lockup.appendChild(el('div', { class: 'es-hero-rule' }));
    lockup.appendChild(el('div', { class: 'es-hero-date',
      text: [fmtDate(data.event_date), data.event_time].filter(Boolean).join(' · ') }));
    // Venue — first configured venue's name, rendered as a
    // separate italic line beneath the date for the classic
    // wedding-invitation lockup. Falls back to the event's own
    // venue string for legacy events created before the wizard
    // tracked multiple venues.
    var heroVenue = (Array.isArray(cfg.venue) && cfg.venue[0] && cfg.venue[0].name) ||
      (data.venue || '');
    if (heroVenue) {
      lockup.appendChild(el('div', { class: 'es-hero-venue', text: heroVenue }));
    }
    // Kicker moved beneath the date — reads as a soft closing tag
    // after the couple lockup rather than competing with the names
    // at the top of the hero.
    lockup.appendChild(el('div', { class: 'es-hero-kicker',
      text: (cfg.hero && cfg.hero.kicker) || "You're invited" }));
    heroTop.appendChild(lockup);
    hero.appendChild(heroTop);

    var heroBottom = el('div', { class: 'es-hero-bottom' });
    var count = el('div', { class: 'es-count' });
    heroBottom.appendChild(count);
    var ctaWrap = el('div');
    heroBottom.appendChild(ctaWrap);
    hero.appendChild(heroBottom);

    // Scroll cue — clickable; jumps past the hero in one tap so a
     // guest who doesn't realise it's a scroll doesn't get stuck.
     var scrollHint = el('div', { class: 'es-hero-scroll', role: 'button', tabindex: '0',
       'aria-label': 'Scroll down' });
     scrollHint.appendChild(el('span', { text: t('scroll') }));
     var circ = el('div', { class: 'es-hero-scroll-circle' });
     circ.innerHTML =
       '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
       '<polyline points="6 9 12 15 18 9"/></svg>';
     scrollHint.appendChild(circ);
     scrollHint.addEventListener('click', function () {
       var nextSec = app.querySelector('.es-section');
       if (nextSec) nextSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
       else window.scrollTo({ top: window.innerHeight, behavior: 'smooth' });
     });
     scrollHint.addEventListener('keydown', function (e) {
       if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollHint.click(); }
     });
     hero.appendChild(scrollHint);

    // Countdown / live switch — same as before, just feeds the new chips.
    function tick() {
      var target = data.event_date ? new Date(data.event_date) : null;
      if (data.event_time && target) {
        var m = String(data.event_time).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (m) {
          var h = parseInt(m[1], 10) % 12;
          if (/pm/i.test(m[3] || '')) h += 12;
          target.setHours(h, m[2] ? parseInt(m[2], 10) : 0, 0, 0);
        }
      }
      if (!target || isNaN(target.getTime())) { count.hidden = true; return; }
      var diff = target.getTime() - Date.now();
      if (diff <= 0) {
        count.hidden = true;
        if (!ctaWrap.dataset.live) {
          ctaWrap.dataset.live = '1';
          ctaWrap.textContent = '';
          var live = el('a', { class: 'es-cta live', href: '/wall/' + ACTIVE_SLUG });
          live.appendChild(document.createTextNode(t('happening') + ' — ' + t('openWall')));
          ctaWrap.appendChild(live);
        }
        return;
      }
      var s = Math.floor(diff / 1000);
      var parts2 = [
        [Math.floor(s / 86400), t('days')],
        [Math.floor(s / 3600) % 24, t('hrs')],
        [Math.floor(s / 60) % 60, t('min')],
        [s % 60, t('sec')]
      ];
      count.textContent = '';
      parts2.forEach(function (p) {
        var d = el('div');
        d.appendChild(el('b', { text: String(p[0]) }));
        d.appendChild(el('span', { text: p[1] }));
        count.appendChild(d);
      });
    }
    tick();
    // Static date/time only in preview — no live ticking, no shared
    // interval fighting with a real page instance that might exist
    // elsewhere in the same browser tab set.
    if (!PREVIEW_MODE) {
      if (window.__esTimer) clearInterval(window.__esTimer);
      window.__esTimer = setInterval(tick, 1000);
    }

    app.appendChild(hero);
    app.appendChild(nav);
    if (!PREVIEW_MODE) {
      // Menu sheet lives on body (not inside app) so it overlays the
      // whole page including the sticky nav. Re-appended on every
      // render so the language/state stays in sync. Skipped in preview
      // mode — the builder page's own body must stay untouched.
      var prevMenu = document.getElementById('esMenu');
      if (prevMenu) prevMenu.remove();
      document.body.appendChild(menu);
    }

    // ── Story ──────────────────────────────────────
    if (cfg.story && (cfg.story.body || cfg.story.label)) {
      addNav('story', cfg.story.label || t('story'));
      var grid = el('div', { class: 'es-story-grid' });
      var side = el('div', { class: 'es-story-side',
        text: cfg.story.label || t('story') });
      var body = el('div', { class: 'es-story-body' });
      // Paragraph-split so the drop-cap only hits the first paragraph.
      String(cfg.story.body || '').split(/\n\s*\n/).forEach(function (para) {
        if (para.trim()) body.appendChild(el('p', { text: para.trim() }));
      });
      grid.appendChild(side);
      grid.appendChild(body);
      // No h2 title here -- .es-story-side already renders this same
      // label as the section's visual heading (large italic, accent
      // border), so passing it to section() too printed it twice.
      app.appendChild(section('story', t('eyebrowStory'), null, grid));
    }

    // ── Details: schedule, venues, dress code, parking ──
    var hasDetails = (cfg.schedule || cfg.venue || cfg.dressCode || cfg.parking);
    if (hasDetails) {
      addNav('details', t('details'));
      var box = el('div');

      // Schedule (tolerant parser)
      var sched = parseSchedule(cfg.schedule);
      if (sched.length) {
        var tl = el('div', { class: 'es-timeline' });
        sched.forEach(function (s) {
          var row = el('div', { class: 'es-tl-row' });
          row.appendChild(el('div', { class: 'es-tl-time', text: s.time || '—' }));
          var b = el('div', { class: 'es-tl-body' });
          if (s.title) b.appendChild(el('div', { class: 'es-tl-title', text: s.title }));
          if (s.sub)   b.appendChild(el('div', { class: 'es-tl-sub',   text: s.sub }));
          row.appendChild(b);
          tl.appendChild(row);
        });
        box.appendChild(tl);
      }

      // Venues
      if (Array.isArray(cfg.venue) && cfg.venue.length) {
        var venues = el('div', { class: 'es-venues' + (cfg.venue.length > 1 ? ' two' : '') });
        venues.style.marginTop = sched.length ? '50px' : '0';
        cfg.venue.forEach(function (v) {
          var card = el('div', { class: 'es-venue' });
          var head = el('div', { class: 'es-venue-head' });
          if (v.name)    head.appendChild(el('div', { class: 'es-venue-name', text: v.name }));
          if (v.address) head.appendChild(el('div', { class: 'es-venue-addr', text: v.address }));
          card.appendChild(head);
          var q = v.mapQuery || v.address || v.name;
          if (q) {
            var f = el('iframe', { class: 'es-map', loading: 'lazy',
              referrerpolicy: 'no-referrer-when-downgrade',
              src: 'https://www.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed' });
            card.appendChild(f);
            // Nearby stays — auto-built deep links into the major
            // booking sites pre-filtered to this venue.
            card.appendChild(buildNearbyStays(v.name || v.address || q, q));
          }
          venues.appendChild(card);
        });
        box.appendChild(venues);
      }

      // Dress code + parking strip
      var hasDress  = cfg.dressCode && (cfg.dressCode.note || (cfg.dressCode.swatches || []).length);
      var hasPark   = cfg.parking && cfg.parking.note;
      if (hasDress || hasPark) {
        var ng = el('div', { class: 'es-note-grid' + ((hasDress && hasPark) ? ' two' : '') });
        if (hasDress) {
          var d = el('div', { class: 'es-note' });
          d.appendChild(el('h3', { text: 'Dress code' }));
          if (cfg.dressCode.note) d.appendChild(el('p', { text: cfg.dressCode.note }));
          if (Array.isArray(cfg.dressCode.swatches) && cfg.dressCode.swatches.length) {
            var sw = el('div', { class: 'es-swatches' });
            cfg.dressCode.swatches.forEach(function (hex) {
              var c = el('div', { class: 'es-swatch' });
              // hex is host input; assigned via style only, never raw HTML.
              c.style.background = String(hex).slice(0, 24);
              sw.appendChild(c);
            });
            d.appendChild(sw);
          }
          ng.appendChild(d);
        }
        if (hasPark) {
          var pk = el('div', { class: 'es-note' });
          pk.appendChild(el('h3', { text: 'Parking & directions' }));
          pk.appendChild(el('p', { text: cfg.parking.note }));
          ng.appendChild(pk);
        }
        box.appendChild(ng);
      }

      app.appendChild(section('details', t('eyebrowDetails'), t('details'), box));
    }

    // ── Entourage (rendered inside a paper-style card) ──
    // Sits right after Details so guests read the schedule then
    // immediately see who's standing up with the couple — the two
    // sections together act as the "programme" half of the page,
    // with Gallery / RSVP / FAQ following as guest-action surfaces.
    if (Array.isArray(cfg.entourage) && cfg.entourage.length) {
      addNav('entourage', t('entourage'));
      var card = el('div', { class: 'es-entourage-card' });
      card.appendChild(el('div', { class: 'es-entourage-title', text: t('entourage') }));
      // Small ornamental flourish — pure SVG (no extra deps) so the
      // card feels like a printed programme rather than a div.
      var flourish = el('div', { class: 'es-entourage-flourish' });
      flourish.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">' +
        '<path d="M12 3v6m0 6v6M3 12h6m6 0h6"/>' +
        '<circle cx="12" cy="12" r="2"/>' +
        '</svg>';
      card.appendChild(flourish);
      var ent = el('div', { class: 'es-entourage' });
      cfg.entourage.forEach(function (grp) {
        var blk = el('div', { class: 'es-ent-group' });
        blk.appendChild(el('h4', { text: grp.group || '' }));
        (grp.people || []).forEach(function (person) {
          blk.appendChild(el('div', { class: 'person', text: person }));
        });
        ent.appendChild(blk);
      });
      card.appendChild(ent);
      app.appendChild(section('entourage', t('eyebrowEntourage'), t('entourage'), card));
    }

    // ── Gallery ──────────────────────────────────────
    // Each tile pulls a CDN-transformed variant; lightbox link still
    // points at the original. Sizes hint matches the 6-col editorial
    // grid: featured tiles span ~half the viewport on desktop, full
    // width on mobile (see .es-gallery CSS).
    if (cfg.gallery && Array.isArray(cfg.gallery.images) && cfg.gallery.images.length) {
      addNav('gallery', cfg.gallery.label || t('gallery'));
      var g = el('div', { class: 'es-gallery' });
      cfg.gallery.images.forEach(function (u) {
        var a = el('a', { href: u, target: '_blank', rel: 'noopener' });
        var img = el('img', {
          loading: 'lazy', decoding: 'async', alt: '',
          src: cdnImage(u, 800),
          srcset: cdnSrcset(u, [400, 600, 800, 1200]),
          sizes: '(min-width: 880px) 540px, (min-width: 720px) 360px, 50vw'
        });
        a.appendChild(img);
        g.appendChild(a);
      });
      app.appendChild(section('gallery', t('eyebrowGallery'), cfg.gallery.label || t('gallery'), g));
    }

    // ── Memory Album (guest-facing "the wall goes here" section) ──
    // Always rendered, unlike Gallery above (which only appears once
    // the host has curated photos). Pre-event this is pure anticipation
    // copy with no CTA — it's a guest's wedding/party site, a paywall
    // pitch here reads wrong. During the upload window it links to the
    // real wall. States driven off upload_window_starts_at/ends_at
    // (same columns events.js uses for the dashboard's own lock UI).
    (function () {
      addNav('memory-album', t('memoryAlbum'));
      var wrap = el('div', { class: 'es-note' });
      var now = Date.now();
      var startsAt = data.upload_window_starts_at ? new Date(data.upload_window_starts_at).getTime() : null;
      var endsAt = data.upload_window_ends_at ? new Date(data.upload_window_ends_at).getTime() : null;
      var uploading = (startsAt === null || now >= startsAt) && (endsAt === null || now < endsAt);
      var isFreePlan = data.plan === 'tala' || data.plan === 'demo';

      // Decorative-only teaser row (no photos, no data — see CSS
      // comment above). Gives the free-plan copy something visual to
      // sit under instead of reading as bare text. Guest-safe: this
      // never sells TO the guest, it only illustrates what the host
      // can unlock, matching the copy immediately below it.
      if (isFreePlan) {
        wrap.appendChild(el('div', { class: 'es-album-teaser-lock', text: '🔒 ' + t('memoryAlbum') }));
        var teaser = el('div', { class: 'es-album-teaser', 'aria-hidden': 'true' });
        for (var ti = 0; ti < 3; ti++) teaser.appendChild(el('div', { class: 'es-album-teaser-card' }));
        wrap.appendChild(teaser);
      }

      if (uploading) {
        var count = data.upload_count || 0;
        wrap.appendChild(el('p', { text: isFreePlan
          ? 'Share a few event photos here. The host can unlock the full Memory Album for unlimited photos, video greetings, and the live wall.'
          : (count > 0 ? t('memoryAlbumCountMsg').replace('{count}', count) : t('memoryAlbumLiveMsg')) }));
        var up = el('a', { class: 'es-btn', href: '/upload/' + ACTIVE_SLUG, text: t('upload') });
        wrap.appendChild(up);
        if (isFreePlan && count > 0) {
          wrap.appendChild(el('p', { text: t('memoryAlbumCountMsg').replace('{count}', count) }));
        }
      } else {
        wrap.appendChild(el('p', { text: isFreePlan
          ? 'The host can unlock the full Memory Album so guests can share photos and video greetings from this event.'
          : t('memoryAlbumPreMsg') }));
      }
      app.appendChild(section('memory-album', t('eyebrowMemoryAlbum'), t('memoryAlbum'), wrap));
    })();

    // ── Find your seat ───────────────────────────────
    if (cfg.seatEnabled !== false) {
      addNav('seat', t('seat'));
      var sw2 = el('div', { class: 'es-form-wrap' });
      var inp = el('input', { class: 'es-field', type: 'text',
        placeholder: t('seatHint'), 'aria-label': t('nameLbl') });
      var btn = el('button', { class: 'es-btn', text: t('seatBtn') });
      var out = el('div', { class: 'es-result' });
      function lookup() {
        var q = inp.value.trim();
        if (q.length < 2) return;
        btn.disabled = true;
        api('/seat-lookup?q=' + encodeURIComponent(q)).then(function (r) {
          return r.ok ? r.json() : { matches: [] };
        }).then(function (j) {
          out.textContent = '';
          if (j.matches && j.matches.length) {
            j.matches.forEach(function (m) {
              var card = el('div', { class: 'seat-card' });
              // Always show the matched guest name first so two
              // people with the same first/last name (or the same
              // person on two lists) can tell which card is theirs.
              if (m.guest_name) {
                card.appendChild(el('div', { class: 'seat-name', text: m.guest_name }));
              }
              // Strip a leading "Table " from the host's label so
              // hosts who typed "Table 50" don't get "Table Table 50"
              // (we always prepend the localized "Table" prefix).
              var rawLabel = String(m.table_label || '').trim();
              var cleanLabel = rawLabel.replace(/^table\s+/i, '');
              card.appendChild(el('div', { class: 'tbl',
                text: t('table') + ' ' + (cleanLabel || '—') }));
              if (m.location_note) card.appendChild(el('p', { text: m.location_note }));
              if (m.seat_note) card.appendChild(el('p', { text: m.seat_note }));
              out.appendChild(card);
            });
          } else {
            out.appendChild(el('div', { class: 'es-note-line', text: t('noSeat') }));
          }
        }).finally(function () { btn.disabled = false; });
      }
      btn.addEventListener('click', lookup);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') lookup(); });
      sw2.appendChild(inp); sw2.appendChild(btn); sw2.appendChild(out);
      app.appendChild(section('seat', t('eyebrowSeat'), t('seat'), sw2));
    }

    // ── RSVP ─────────────────────────────────────────
    if (cfg.rsvpEnabled !== false) {
      addNav('rsvp', t('rsvp'));

      // Deadline gate — if config.rsvpDeadline is set and past,
      // replace the entire form with a "closed" card so guests
      // don't even see input fields they can't submit. Backend
      // enforces this too (returns 410), this is just the UX
      // layer so it fails honestly client-side.
      var deadlineRaw = cfg.rsvpDeadline || '';
      var deadlineDate = null;
      if (deadlineRaw) {
        deadlineDate = new Date(deadlineRaw);
        if (Number.isNaN(deadlineDate.getTime())) deadlineDate = null;
        // YYYY-MM-DD parses to UTC midnight — bump to end-of-day so
        // a deadline of "May 31" stays open through the day.
        else if (/^\d{4}-\d{2}-\d{2}$/.test(String(deadlineRaw))) {
          deadlineDate.setUTCHours(23, 59, 59, 999);
        }
      }
      var deadlinePassed = deadlineDate && Date.now() > deadlineDate.getTime();

      if (deadlinePassed) {
        var closed = el('div', { class: 'es-rsvp-closed' });
        var lock = el('div', { class: 'lock' });
        lock.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<rect x="5" y="11" width="14" height="9" rx="2"/>' +
          '<path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
        closed.appendChild(lock);
        closed.appendChild(el('div', { class: 'title', text: t('rsvpClosed') }));
        closed.appendChild(el('div', { class: 'sub', text: t('rsvpClosedSub') }));
        closed.appendChild(el('div', { class: 'when',
          text: t('rsvpBy') + ' ' + fmtDate(deadlineDate.toISOString()) }));
        app.appendChild(section('rsvp', t('eyebrowRsvp'), t('rsvp'), closed));
      } else {
        buildRsvpForm(deadlineDate);
      }
    }

    function buildRsvpForm(deadlineDate) {
      var form = el('div', { class: 'es-form-wrap' });
      var name = el('input', { class: 'es-field', type: 'text', placeholder: t('nameLbl') });
      // Optional email — when provided the backend mails the guest a
      // confirmation. The host always gets notified regardless; this
      // is purely for the guest's own records.
      var emailIn = el('input', { class: 'es-field', type: 'email',
        inputmode: 'email', autocomplete: 'email',
        placeholder: t('emailLbl') });
      var attRow = el('div', { class: 'es-field-row' });
      var att = el('select', { class: 'es-field' });
      att.appendChild(el('option', { value: 'yes', text: t('attending') }));
      att.appendChild(el('option', { value: 'no',  text: t('notAttending') }));
      var party = el('input', { class: 'es-field', type: 'number', min: '1', value: '1',
        'aria-label': t('party'), placeholder: t('party') });
      attRow.appendChild(att); attRow.appendChild(party);
      // Note placeholder bumped from generic "A note (optional)" to
      // a concrete prompt — song requests are the most common ask
      // hosts get and naming it raises response quality.
      var msg = el('textarea', { class: 'es-field', rows: '3', placeholder: t('noteHint') });
      var send = el('button', { class: 'es-btn', text: t('send') });
      // Two slots: a quiet error line below the button (validation /
      // network failures) and a swap area for the prominent success
      // card. Kept separate so an error doesn't tear down the form.
      var errLine = el('div', { class: 'es-rsvp-error' });
      errLine.style.display = 'none';
      var successWrap = el('div');

      function resetForm() {
        name.value = '';
        emailIn.value = '';
        att.value = 'yes';
        party.value = '1';
        msg.value  = '';
      }
      function showError(text) {
        successWrap.textContent = '';
        errLine.textContent = text;
        errLine.style.display = 'block';
      }
      function showSuccess() {
        errLine.style.display = 'none';
        resetForm();
        // Hide the form fields and the send button — guest gets a
        // single clear "saved" surface instead of seeing the form
        // still sitting there, which makes it unclear whether it
        // saved or whether they need to click again.
        [name, emailIn, attRow, msg, send].forEach(function (n) { n.style.display = 'none'; });

        var box = el('div', { class: 'es-rsvp-success' });
        var check = el('div', { class: 'check' });
        check.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M5 12l5 5L20 7"/></svg>';
        box.appendChild(check);
        box.appendChild(el('div', { class: 'msg', text: t('sent') }));
        box.appendChild(el('div', { class: 'sub', text: 'Salamat — see you there!' }));
        var again = el('button', { type: 'button', class: 'again', text: 'Add another RSVP' });
        again.addEventListener('click', function () {
          successWrap.textContent = '';
          [name, emailIn, attRow, msg, send].forEach(function (n) { n.style.display = ''; });
          name.focus();
        });
        box.appendChild(again);
        successWrap.textContent = '';
        successWrap.appendChild(box);
      }

      send.addEventListener('click', function () {
        var nm = name.value.trim();
        if (!nm) { name.focus(); return; }
        send.disabled = true;
        errLine.style.display = 'none';
        api('/rsvp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guest_name: nm,
            email: emailIn.value.trim() || undefined,
            attending: att.value === 'yes',
            party_size: parseInt(party.value, 10) || 1,
            message: msg.value.trim()
          })
        }).then(function (r) {
          if (r.ok) { showSuccess(); return; }
          // Backend returns 410 when the deadline has passed
          // between page load and submit — swap to the closed
          // state so the guest doesn't keep retrying.
          if (r.status === 410) {
            return r.json().catch(function () { return {}; }).then(function (j) {
              showError('RSVPs are closed' +
                (j && j.deadline ? ' (deadline was ' + fmtDate(j.deadline) + ').' : '.'));
              send.disabled = true;
            });
          }
          showError('Hmm, that didn’t go through. Please try again.');
        }).catch(function () {
          showError('Hmm, that didn’t go through. Please try again.');
        }).finally(function () { /* send.disabled handled per-branch */ });
      });
      form.appendChild(name);
      form.appendChild(emailIn);
      form.appendChild(attRow);
      form.appendChild(msg);
      form.appendChild(send);
      form.appendChild(errLine);
      // Deadline line — only rendered when the host configured one
      // and we're still inside it. The closed-state branch above
      // handles the past-deadline case with a bigger card.
      if (deadlineDate) {
        var dl = el('div', { class: 'es-rsvp-deadline' });
        dl.appendChild(document.createTextNode(t('rsvpBy') + ' '));
        dl.appendChild(el('strong', { text: fmtDate(deadlineDate.toISOString()) }));
        form.appendChild(dl);
      }
      form.appendChild(successWrap);
      app.appendChild(section('rsvp', t('eyebrowRsvp'), t('rsvp'), form));
    }

    // ── FAQ ─────────────────────────────────────────
    if (Array.isArray(cfg.faq) && cfg.faq.length) {
      addNav('faq', t('faq'));
      var fq = el('div', { class: 'es-faq' });
      cfg.faq.forEach(function (item) {
        var d = el('details');
        d.appendChild(el('summary', { text: item.q || '' }));
        d.appendChild(el('p', { text: item.a || '' }));
        fq.appendChild(d);
      });
      app.appendChild(section('faq', t('eyebrowFaq'), t('faq'), fq));
    }


    // ── Good to know (parsed `||` items as a card grid) ──
    var gtk = parseGoodToKnow(cfg.goodToKnow);
    if (gtk.length) {
      addNav('good', t('goodToKnow'));
      var gw = el('div', { class: 'es-gtk' });
      gtk.forEach(function (item) {
        var c = el('div', { class: 'es-gtk-card' });
        if (item.title) c.appendChild(el('h4', { text: item.title }));
        if (item.body)  c.appendChild(el('p',  { text: item.body }));
        gw.appendChild(c);
      });
      app.appendChild(section('good', t('eyebrowFaq'), t('goodToKnow'), gw));
    }

    // ── Registry / Gifts ───────────────────────────
    // Discreet "With Love" section — message, registry links,
    // cash funds with tap-to-copy + optional QR, and a single
    // honeymoon feature card. Hidden entirely when the host
    // hasn't enabled it or hasn't added any entries.
    var reg = cfg.registry || null;
    if (reg && reg.enabled !== false) {
      var hasLinks = Array.isArray(reg.links) && reg.links.length;
      var hasCash  = Array.isArray(reg.cashFunds) && reg.cashFunds.length;
      if (hasLinks || hasCash) {
        addNav('registry', t('registry'));
        var wrap = el('div');
        if (reg.message) {
          wrap.appendChild(el('div', { class: 'es-registry-msg', text: reg.message }));
        }
        var grid = el('div', { class: 'es-registry-grid' });

        // Registry links — outline cards that open in a new tab.
        if (hasLinks) {
          reg.links.forEach(function (link) {
            if (!link || !link.url) return;
            var card = el('a', { class: 'es-reg-link', href: link.url,
              target: '_blank', rel: 'noopener noreferrer' });
            var icon = el('div', { class: 'icon' });
            icon.innerHTML =
              '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h7"/>' +
              '<path d="M14 4h6v6"/><path d="M10 14L20 4"/></svg>';
            card.appendChild(icon);
            var body = el('div', { class: 'body' });
            body.appendChild(el('div', { class: 'lbl', text: link.label || link.url }));
            // Show only the host of the URL — keeps the line tidy
            // and avoids exposing tracking query strings.
            var host = '';
            try { host = new URL(link.url).host; } catch (e) { host = link.url; }
            body.appendChild(el('div', { class: 'url', text: host }));
            card.appendChild(body);
            card.appendChild(el('div', { class: 'chev', text: '→' }));
            grid.appendChild(card);
          });
        }

        // Cash funds — paper cards with tap-to-copy + QR.
        if (hasCash) {
          reg.cashFunds.forEach(function (f) {
            if (!f || !f.account) return;
            var card = el('div', { class: 'es-reg-cash' });
            if (f.type || f.label) {
              card.appendChild(el('div', { class: 'type-tag',
                text: (f.label || f.type) }));
            }
            if (f.name) card.appendChild(el('div', { class: 'holder', text: f.name }));
            var row = el('div', { class: 'number-row' });
            row.appendChild(el('div', { class: 'number', text: String(f.account) }));
            var copy = el('button', { type: 'button', class: 'copy-btn', text: t('tapCopy') });
            copy.addEventListener('click', function () {
              var acct = String(f.account);
              var done = function () {
                copy.textContent = t('copied');
                copy.classList.add('done');
                setTimeout(function () {
                  copy.textContent = t('tapCopy');
                  copy.classList.remove('done');
                }, 1800);
              };
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(acct).then(done, done);
              } else {
                // Fallback for older mobile WebViews.
                var ta = document.createElement('textarea');
                ta.value = acct;
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch (e) {}
                document.body.removeChild(ta);
                done();
              }
            });
            row.appendChild(copy);
            card.appendChild(row);
            if (f.qrUrl) {
              var q = el('div', { class: 'qr' });
              q.appendChild(el('img', {
                src: cdnImage(f.qrUrl, 300),
                alt: (f.label || 'QR code') + ' QR',
                loading: 'lazy', decoding: 'async'
              }));
              card.appendChild(q);
            }
            grid.appendChild(card);
          });
        }

        wrap.appendChild(grid);
        app.appendChild(section('registry', t('eyebrowRegistry'), t('registry'), wrap));
      }
    }

    // ── Footer (share / calendar / upload) ──────────
    var foot = el('div', { class: 'es-foot' });
    foot.appendChild(el('div', { class: 'es-foot-eyebrow', text: t('eyebrowFootInvite') }));
    foot.appendChild(el('div', { class: 'es-foot-title', text: t('footTitle') }));

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function icsStamp(dt) {
      return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate()) +
        'T' + pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + '00Z';
    }
    var actions = el('div', { class: 'es-foot-actions' });
    var start = data.event_date ? new Date(data.event_date) : null;
    if (start && data.event_time) {
      var mm = String(data.event_time).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (mm) {
        var hh = parseInt(mm[1], 10) % 12;
        if (/pm/i.test(mm[3] || '')) hh += 12;
        start.setHours(hh, mm[2] ? parseInt(mm[2], 10) : 0, 0, 0);
      }
    }
    if (start && !isNaN(start.getTime())) {
      var end = new Date(start.getTime() + 4 * 3600 * 1000);
      var cal = el('a', { class: 'es-btn ghost', text: t('addCal') });
      var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
        'DTSTART:' + icsStamp(start), 'DTEND:' + icsStamp(end),
        'SUMMARY:' + (data.couple_names || 'Celebration'),
        'LOCATION:' + (((cfg.venue || [])[0] || {}).name || ''),
        'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      cal.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
      cal.setAttribute('download', 'event.ics');
      actions.appendChild(cal);
      var gcal = el('a', { class: 'es-btn ghost', text: 'Google Calendar',
        target: '_blank', rel: 'noopener' });
      gcal.href = 'https://www.google.com/calendar/render?action=TEMPLATE&text=' +
        encodeURIComponent(data.couple_names || 'Celebration') +
        '&dates=' + icsStamp(start) + '/' + icsStamp(end);
      actions.appendChild(gcal);
    }
    var shareBtn = el('button', { class: 'es-btn ghost', text: t('share') });
    shareBtn.addEventListener('click', function () {
      var u = location.href;
      if (navigator.share) navigator.share({ title: data.couple_names || 'Reelday', url: u });
      else if (navigator.clipboard) { navigator.clipboard.writeText(u); shareBtn.textContent = '✓'; }
    });
    actions.appendChild(shareBtn);
    var up = el('a', { class: 'es-btn', href: '/upload/' + ACTIVE_SLUG, text: t('upload') });
    actions.appendChild(up);
    foot.appendChild(actions);

    var credit = el('div', { class: 'es-foot-credit' });
    var creditLink = el('a', { href: '/', text: 'Create your own free event website — reelday.ph' });
    credit.appendChild(creditLink);
    foot.appendChild(credit);
    app.appendChild(foot);

    var stateEl = document.getElementById('state');
    if (stateEl) stateEl.hidden = true;
    app.hidden = false;

    // Reveal sections on scroll (single observer, no per-section listeners).
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    app.querySelectorAll('.es-section').forEach(function (s) { io.observe(s); });

    // Show sticky nav once the hero is mostly out of view.
    var navEl = nav;
    var dockEl = null;
    if (!PREVIEW_MODE) {
      // Mobile shortcut dock — only built when the matching sections
      // actually exist on the page. If neither seat finder nor RSVP
      // is enabled, no dock is created (so the CSS @media display:flex
      // doesn't render an empty bar). Both enabled → primary RSVP +
      // secondary seat. Just one enabled → that one fills the dock.
      // Skipped in preview mode — it lives on document.body, outside
      // the builder's own preview container.
      var seatOn = cfg.seatEnabled !== false;
      var rsvpOn = cfg.rsvpEnabled !== false;
      // Dock always renders on phones (it now carries the hamburger);
      // shortcut buttons appear only when their sections are enabled.
      var prevDock = document.getElementById('esDock');
      if (prevDock) prevDock.remove();
      dockEl = el('div', { class: 'es-dock', id: 'esDock' });
      // Hamburger — opens the same full-screen menu the (now-hidden)
      // top nav used to. Reuses openMenu defined above in this scope.
      var dockMenu = el('button', { type: 'button', class: 'es-dock-menu',
        'aria-label': 'Open menu', 'aria-controls': 'esMenu' });
      dockMenu.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" aria-hidden="true">' +
        '<path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      dockMenu.addEventListener('click', openMenu);
      dockEl.appendChild(dockMenu);

      var seatIcon =
        '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M6 21V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12"/>' +
        '<path d="M4 21h16"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg>';
      var rsvpIcon =
        '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M4 7h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg>';
      if (seatOn) dockEl.appendChild(dockBtn('#seat', t('seat'), !rsvpOn, seatIcon));
      if (rsvpOn) dockEl.appendChild(dockBtn('#rsvp', t('rsvp'), true,    rsvpIcon));
      document.body.appendChild(dockEl);
    }

    function dockBtn(href, label, primary, iconSvg) {
      var a = el('a', { class: primary ? 'es-dock-primary' : 'es-dock-secondary',
        href: href });
      a.addEventListener('click', function (e) {
        // Smooth-scroll within the same page; preserves browser
        // history (the hash still updates) so back works as expected.
        // block:'center' lands the section in the middle of the
        // viewport (was 'start', which left short sections like the
        // seat finder sitting awkwardly at the top edge with the
        // next section's eyebrow already showing below).
        var target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          history.replaceState(null, '', href);
        }
      });
      var ico = el('span', { class: 'ico' });
      ico.innerHTML = iconSvg;
      a.appendChild(ico);
      a.appendChild(document.createTextNode(label));
      return a;
    }

    var heroBottomObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.intersectionRatio < 0.25) {
          navEl.classList.add('show');
          if (dockEl) dockEl.classList.add('show');
        } else {
          navEl.classList.remove('show');
          if (dockEl) dockEl.classList.remove('show');
        }
      });
    }, { threshold: [0, 0.25, 1] });
    heroBottomObs.observe(hero);
  }

  window.ReelEventRender = {
    render: render,
    fetchEventData: function (slug) {
      return fetch('/api/event-site/' + encodeURIComponent(slug), {
        headers: { 'X-Guest-Id': GUEST_ID }
      });
    }
  };
})();
