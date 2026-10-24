// PlotPeta: Laci alat kiri dan alat favorit
/* PlotPeta tool drawer and user favorites */
(function () {
  const main = document.getElementById('main');
  const drawer = document.getElementById('toolDrawer');
  const toggle = document.getElementById('toolDrawerToggle');
  const favToggle = document.getElementById('favoriteToggle');
  const favTools = document.getElementById('favoriteBar');
  const favCount = document.getElementById('favoriteCount');
  if (!main || !drawer) return;

  toggle?.addEventListener('click', () => {
    const collapsed = main.classList.toggle('drawer-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Buka laci alat' : 'Tutup laci alat';
    if (typeof syncMode === 'function') syncMode();
  });

  favToggle?.addEventListener('click', () => {
    const expanded = favToggle.getAttribute('aria-expanded') !== 'true';
    favToggle.setAttribute('aria-expanded', String(expanded));
    favTools?.classList.toggle('hide', !expanded);
  });

  const key = 'plotpeta-tool-favorites-v1';
  let favorites = [];
  try { favorites = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { favorites = []; }
  const tools = [...drawer.querySelectorAll('button[data-tool]')];

  // Pilihan metode deteksi/hapus di bilah (muncul saat laci dilipat, karena pilihan di laci ikut tersembunyi)
  const MODE_OPTS = { A: { label: 'Metode deteksi', src: 'detectMode' }, E: { label: 'Metode hapus', src: 'eraseMode' } };
  const modeWrap = document.createElement('label');
  modeWrap.className = 'fav-mode';
  modeWrap.innerHTML = '<span></span><select></select>';
  const modeLbl = modeWrap.querySelector('span'), modeSel = modeWrap.querySelector('select');
  function syncMode() {
    const cfg = MODE_OPTS[tool];
    modeWrap.classList.toggle('visible', !!cfg);
    favTools.classList.toggle('hide', !favTools.querySelector('button') && !cfg);
    const src = cfg && document.getElementById(cfg.src);
    if (!src) return;
    modeLbl.textContent = cfg.label;
    modeSel.innerHTML = src.innerHTML;
    modeSel.value = src.value;
    modeSel.dataset.src = cfg.src;
  }
  modeSel.addEventListener('change', () => {
    const src = document.getElementById(modeSel.dataset.src);
    if (src) { src.value = modeSel.value; src.dispatchEvent(new Event('change')); }
  });
  if (typeof setTool === 'function') {
    const baseSetTool = setTool;
    setTool = function () { const r = baseSetTool.apply(this, arguments); syncMode(); return r; };
  }

  function renderFavorites() {
    if (!favTools) return;
    favTools.innerHTML = '';
    const selected = tools.filter(btn => favorites.includes(btn.dataset.tool));
    favTools.classList.toggle('hide', !selected.length);
    selected.forEach(source => {
      const shortcut = document.createElement('button');
      shortcut.type = 'button';
      shortcut.className = 'favorite-tool-shortcut';
      shortcut.dataset.tool = source.dataset.tool;
      shortcut.title = source.title || '';
      shortcut.innerHTML = source.querySelector('svg')?.outerHTML || '';
      const label = document.createElement('span');
      label.textContent = source.querySelector('span:not(.tool-fav-star)')?.textContent?.trim() || source.dataset.tool;
      shortcut.appendChild(label);
      shortcut.addEventListener('click', () => source.click());
      favTools.appendChild(shortcut);
    });
    favTools.appendChild(modeWrap);
    favTools.classList.toggle('hide', !selected.length && !MODE_OPTS[tool]);
    favTools.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
    syncMode();
    if (favCount) favCount.textContent = String(selected.length);
    tools.forEach(btn => {
      const star = btn.querySelector('.tool-fav-star');
      if (!star) return;
      const active = favorites.includes(btn.dataset.tool);
      star.classList.toggle('is-favorite', active);
      star.textContent = active ? '★' : '☆';
      star.title = active ? 'Hapus dari favorit' : 'Tambah ke favorit (tampil di atas peta)';
      star.setAttribute('aria-label', star.title);
    });
  }

  drawer.addEventListener('click', event => {
    const star = event.target.closest('.tool-fav-star');
    if (!star) return;
    event.preventDefault();
    event.stopPropagation();
    const tool = star.closest('button[data-tool]')?.dataset?.tool;
    if (!tool) return;
    favorites = favorites.includes(tool) ? favorites.filter(item => item !== tool) : [...favorites, tool];
    try { localStorage.setItem(key, JSON.stringify(favorites)); } catch (_) {}
    renderFavorites();
  }, true);
  drawer.addEventListener('keydown', event => {
    const star = event.target.closest('.tool-fav-star');
    if (!star || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    star.click();
  }, true);
  renderFavorites();
  updateToolModeHint();
})();
