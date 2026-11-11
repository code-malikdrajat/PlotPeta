// PlotPeta: layar loading global untuk proses berat.
// show/hide memakai penghitung bersarang; pure helper diekspor untuk tes Node.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.PlotPetaBusy = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function busyReduce(state, action) {
    var count = typeof state === 'number'
      ? state
      : (state && typeof state.count === 'number' ? state.count : 0);
    count = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    var type = typeof action === 'string' ? action : (action && (action.type || action.action));
    if (type === 'show') return { count: count + 1 };
    if (type === 'hide') return { count: Math.max(0, count - 1) };
    return { count: count };
  }

  function busyProgressText(done, total) {
    var t = Number(total);
    t = Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0;
    var d = Number(done);
    d = Number.isFinite(d) ? Math.max(0, Math.min(t, Math.floor(d))) : 0;
    return 'Tile ' + d + ' dari ' + t;
  }

  var state = { count: 0 };
  var els = null;
  var opts = {};
  var previousFocus = null;
  var cancelRequested = false;
  var keyBound = false;

  function ensureDom() {
    if (els || typeof document === 'undefined' || !document.body) return;
    var overlay = document.createElement('div');
    overlay.className = 'pp-busy-overlay';
    overlay.id = 'ppBusyOverlay';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="pp-busy-card" role="status" aria-live="polite" aria-atomic="true" tabindex="-1">' +
        '<div class="pp-busy-spinner" aria-hidden="true"></div>' +
        '<div class="pp-busy-title"></div>' +
        '<div class="pp-busy-detail"></div>' +
        '<div class="pp-busy-progress" role="progressbar" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" hidden>' +
          '<div class="pp-busy-bar"></div>' +
        '</div>' +
        '<button class="pp-busy-cancel" type="button" hidden>Batal</button>' +
      '</div>';
    document.body.appendChild(overlay);
    els = {
      overlay: overlay,
      card: overlay.querySelector('.pp-busy-card'),
      title: overlay.querySelector('.pp-busy-title'),
      detail: overlay.querySelector('.pp-busy-detail'),
      progress: overlay.querySelector('.pp-busy-progress'),
      bar: overlay.querySelector('.pp-busy-bar'),
      cancel: overlay.querySelector('.pp-busy-cancel'),
    };
    overlay.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
    overlay.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    overlay.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    els.cancel.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      requestCancel();
    });
    if (!keyBound) {
      document.addEventListener('keydown', onKeydown, true);
      keyBound = true;
    }
  }

  function render() {
    if (!els) return;
    els.title.textContent = opts.title || 'Memproses…';
    els.detail.textContent = opts.detail || '';
    var total = Number(opts.total);
    var determinate = Number.isFinite(total) && total > 0;
    els.progress.hidden = !determinate;
    if (determinate) {
      var done = Number(opts.done);
      done = Number.isFinite(done) ? Math.max(0, Math.min(total, Math.floor(done))) : 0;
      els.progress.setAttribute('aria-valuemax', String(total));
      els.progress.setAttribute('aria-valuenow', String(done));
      els.bar.style.width = ((done / total) * 100).toFixed(2) + '%';
    } else {
      els.bar.style.width = '0%';
    }
    els.cancel.hidden = !opts.cancelable;
  }

  function focusPrimary() {
    if (!els) return;
    var target = opts.cancelable ? els.cancel : els.card;
    try { target.focus(); } catch (_) { /* abaikan */ }
  }

  function requestCancel() {
    if (cancelRequested || !opts.cancelable) return;
    cancelRequested = true;
    try {
      if (typeof opts.onCancel === 'function') opts.onCancel();
    } catch (_) { /* abaikan */ }
  }

  function onKeydown(e) {
    if (state.count <= 0) return;
    if (els && e.target === els.cancel && (e.key === 'Enter' || e.key === ' ')) {
      e.stopImmediatePropagation();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      requestCancel();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      focusPrimary();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
  }

  function show(next) {
    ensureDom();
    if (state.count === 0) {
      previousFocus = (typeof document !== 'undefined' && document.activeElement) || null;
      cancelRequested = false;
      // Hentikan interaksi kanvas yang mungkin sedang berjalan.
      try { if (typeof closeTextEditPopover === 'function') closeTextEditPopover(); } catch (_) { /* abaikan */ }
      try { if (typeof drag !== 'undefined') drag = null; } catch (_) { /* abaikan */ }
      try { if (typeof textDrag !== 'undefined') textDrag = null; } catch (_) { /* abaikan */ }
      try { if (typeof mv !== 'undefined') mv = null; } catch (_) { /* abaikan */ }
      try { if (typeof restoreCanvasCursor === 'function') restoreCanvasCursor(); } catch (_) { /* abaikan */ }
    }
    state = busyReduce(state, 'show');
    opts = Object.assign({}, opts, next || {});
    if (!els) return;
    els.overlay.hidden = false;
    els.overlay.setAttribute('aria-hidden', 'false');
    render();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusPrimary);
    else setTimeout(focusPrimary, 0);
  }

  function update(next) {
    if (state.count <= 0) return;
    opts = Object.assign({}, opts, next || {});
    render();
  }

  function hide() {
    if (state.count <= 0) return;
    state = busyReduce(state, 'hide');
    if (state.count > 0) return;
    if (els) {
      els.overlay.hidden = true;
      els.overlay.setAttribute('aria-hidden', 'true');
    }
    cancelRequested = false;
    opts = {};
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
      try { previousFocus.focus(); } catch (_) { /* abaikan */ }
    }
    previousFocus = null;
  }

  return {
    show: show,
    update: update,
    hide: hide,
    busyReduce: busyReduce,
    busyProgressText: busyProgressText,
    progressText: busyProgressText,
  };
});
