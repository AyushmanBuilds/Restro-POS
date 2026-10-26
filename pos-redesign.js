/* Zayka Serve — POS redesign helpers.
   Additive only (same approach as premium.js): it reads the DOM that app.js
   already renders and clicks your existing buttons. It never touches app.js
   logic, Firestore data or any element ID. */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toRGB(c) {
    if (!c) return null;
    if (c.charAt(0) === '#') {
      var h = c.slice(1);
      if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
      var n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var m = c.match(/\d+(\.\d+)?/g);
    return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : null;
  }
  function once(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ------------------------------------------------------------------
     1. TABLES — live service meter + keyboard access for table tiles
     ------------------------------------------------------------------ */
  function initTables() {
    var grid = $('tableGrid'), box = $('floorStats');
    if (!grid || !box) return;

    function stats() {
      var q = function (s) { return grid.querySelectorAll(s).length; };
      var total = q('.table-card'), free = q('.table-card.tc-free'),
          full = q('.table-card.tc-full'), part = q('.table-card.tc-partial'),
          seats = q('.table-card .chair'), taken = q('.table-card .chair.taken');
      var sig = [total, free, full, part, seats, taken].join('|');
      if (box.dataset.k === sig) return;
      box.dataset.k = sig;

      if (!total) { box.innerHTML = '<div class="fs-empty">No tables to show yet.</div>'; return; }
      var busy = full + part, w = function (n) { return (n / total * 100).toFixed(2) + '%'; };
      box.innerHTML =
        '<div class="fs-lead"><span class="fs-big">' + busy + '</span>' +
        '<span class="fs-cap">of ' + total + ' table' + (total === 1 ? '' : 's') + '<br>in service</span></div>' +
        '<div class="fs-side">' +
          '<div class="fs-meter" role="img" aria-label="' + free + ' free, ' + full + ' occupied, ' + part + ' partly taken">' +
            '<i class="m-full" style="width:' + w(full) + '"></i><i class="m-part" style="width:' + w(part) + '"></i>' +
          '</div>' +
          '<div class="fs-legend">' +
            '<span class="lg-free"><i></i><b>' + free + '</b>Free</span>' +
            '<span class="lg-full"><i></i><b>' + full + '</b>Occupied</span>' +
            '<span class="lg-part"><i></i><b>' + part + '</b>Partly taken</span>' +
            '<span class="lg-seats"><b>' + taken + '</b>of ' + seats + ' seats taken</span>' +
          '</div>' +
        '</div>';
    }

    function a11y() {
      grid.querySelectorAll('.table-card:not([data-a])').forEach(function (c) {
        c.dataset.a = '1';
        c.tabIndex = 0;
        c.setAttribute('role', 'button');
        var n = c.querySelector('.tc-name'), s = c.querySelector('.tc-status');
        c.setAttribute('aria-label', (n ? n.textContent : 'Table') + ', ' + (s ? s.textContent : ''));
      });
    }

    function update() { stats(); a11y(); }
    new MutationObserver(update).observe(grid, { childList: true, subtree: true });
    grid.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('table-card')) {
        e.preventDefault(); e.target.click();
      }
    });
    update();
  }

  /* ------------------------------------------------------------------
     2. ORDER — category chips, category colour on items, ticket badge
     ------------------------------------------------------------------ */
  function initOrder() {
    var catGrid = $('menuCatGrid'), crumb = $('menuBreadcrumb'), search = $('menuSearchInput');
    var panel = document.querySelector('#view-order .order-menu-pick');
    var cats = [];

    function scanCats() {
      if (!catGrid) return;
      var tiles = catGrid.querySelectorAll('.cat-box');
      if (!tiles.length) return;
      var out = [];
      tiles.forEach(function (t) {
        if (!t.dataset.pxc) {
          // colour was set inline by app.js (catColor); remember it before CSS repaints the tile white
          t.dataset.pxc = t.style.backgroundColor || '#D64526';
          var rgb = toRGB(t.dataset.pxc) || [214, 69, 38];
          t.style.setProperty('--cat', t.dataset.pxc);
          t.style.setProperty('--cat-soft', 'rgba(' + rgb.join(',') + ',.14)');
        }
        var cnt = t.querySelector('.cat-box-count');
        out.push({
          name: t.dataset.cat,
          color: t.dataset.pxc,
          count: cnt ? (parseInt(cnt.textContent, 10) || 0) : 0
        });
      });
      cats = out;
      renderChips();
    }

    function renderChips() {
      if (!crumb || !cats.length) return;
      var host = crumb.querySelector('.cat-chips');
      if (!host) {
        host = document.createElement('div');
        host.className = 'cat-chips';
        crumb.appendChild(host);
        host.addEventListener('click', onChip);
      }
      var title = ($('menuBreadcrumbTitle') || {}).textContent || '';
      var searching = search && search.value.trim();
      var active = searching ? '' : title;
      // guard writes: classList.add() queues a mutation even when nothing changed, which would re-trigger this observer
      if (!crumb.classList.contains('has-chips')) crumb.classList.add('has-chips');
      if (crumb.classList.contains('is-search') !== !!searching) crumb.classList.toggle('is-search', !!searching);
      var sig = active + '|' + cats.map(function (c) { return c.name + ':' + c.count; }).join(',');
      if (host.dataset.k !== sig) {
        host.dataset.k = sig;
        host.innerHTML = cats.map(function (c) {
          return '<button type="button" class="cat-chip' + (c.name === active ? ' on' : '') +
            '" data-cat="' + esc(c.name) + '" style="--cat:' + esc(c.color) + '"><i></i>' +
            esc(c.name) + '<em>' + c.count + '</em></button>';
        }).join('');
        var on = host.querySelector('.on');
        if (on) host.scrollLeft = on.offsetLeft - (host.clientWidth - on.offsetWidth) / 2;
      }
      // items inherit the active category colour
      var cur = cats.filter(function (c) { return c.name === active; })[0];
      if (panel) {
        if (cur) panel.style.setProperty('--cat', cur.color);
        else panel.style.removeProperty('--cat');
      }
    }

    function onChip(e) {
      var b = e.target.closest ? e.target.closest('.cat-chip') : null;
      if (!b) return;
      if (search && search.value) search.value = '';          // search would otherwise override the category
      var tiles = catGrid ? catGrid.querySelectorAll('.cat-box') : [];
      for (var i = 0; i < tiles.length; i++) {
        if (tiles[i].dataset.cat === b.dataset.cat) { tiles[i].click(); break; }
      }
    }

    if (catGrid) new MutationObserver(scanCats).observe(catGrid, { childList: true });
    if (crumb) new MutationObserver(renderChips).observe(crumb, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    if (search) search.addEventListener('input', function () { setTimeout(renderChips, 0); });
    scanCats();

    // ticket: item-count badge
    var list = $('cartList'), badge = $('cartCountBadge');
    function badgeUpdate() {
      if (!list || !badge) return;
      var qty = 0;
      list.querySelectorAll('.ci-qty b').forEach(function (b) { qty += parseInt(b.textContent, 10) || 0; });
      var txt = qty ? qty + (qty === 1 ? ' item' : ' items') : 'Empty';
      if (badge.textContent !== txt) badge.textContent = txt;
      badge.classList.toggle('has', qty > 0);
    }
    if (list) new MutationObserver(badgeUpdate).observe(list, { childList: true, subtree: true });
    badgeUpdate();

    // header state dot: new order vs order in progress
    var st = $('orderTableEyebrow');
    function liveState() { if (st) st.dataset.live = /progress/i.test(st.textContent) ? '1' : '0'; }
    if (st) new MutationObserver(liveState).observe(st, { childList: true, characterData: true, subtree: true });
    liveState();
  }

  /* ------------------------------------------------------------------
     3. SETTINGS — section nav with scroll-spy, volume fill
     ------------------------------------------------------------------ */
  function initSettings() {
    var view = $('view-settings'), nav = $('stNav');
    if (!view || !nav) return;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    view.addEventListener('click', function (e) {
      var j = e.target.closest ? e.target.closest('[data-jump]') : null;
      if (!j) return;
      var target = $(j.dataset.jump);
      if (target) target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });

    var buttons = [].slice.call(nav.querySelectorAll('[data-jump]'));
    function mark(id) { buttons.forEach(function (b) { b.classList.toggle('on', b.dataset.jump === id); }); }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) mark(en.target.id); });
      }, { rootMargin: '-25% 0px -65% 0px' });
      buttons.forEach(function (b) { var s = $(b.dataset.jump); if (s) io.observe(s); });
    }

    // volume slider: paint the filled part of the track
    var vol = $('notifVolumeRange');
    function paint() {
      if (!vol) return;
      var min = +vol.min || 0, max = +vol.max || 100;
      vol.style.setProperty('--fill', ((vol.value - min) / (max - min) * 100) + '%');
    }
    if (vol) {
      vol.addEventListener('input', paint);
      // app.js sets the stored value programmatically, so repaint whenever the view opens
      new MutationObserver(paint).observe(view, { attributes: true, attributeFilter: ['class'] });
      paint();
    }
  }

  once(function () { initTables(); initOrder(); initSettings(); });
})();
