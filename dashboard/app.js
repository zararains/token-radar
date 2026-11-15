// Token Radar's page. Plain script, no framework, no network: everything it
// shows arrived in data.js (window.RADAR), written by main.ts from the same
// figures board.json was ranked by, so the page and the board cannot drift.
//
// State lives in the hash: #/ is the board, #/?cat=Dexs&watch=1 a filtered
// board, #/live the protocols set aside because their token already trades,
// and #/p/<slug> one protocol's detail view — its figures, the arithmetic
// behind its implied value, and its farm plan.

(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');

  // -- formatting -----------------------------------------------------------

  function esc(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtUsd(value) {
    if (value === null || value === undefined) return '—';
    var abs = Math.abs(value);
    if (abs >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'K';
    return '$' + String(value);
  }

  function fmtPct(change) {
    if (change === null || change === undefined) return '<span class="flat">n/a</span>';
    var cls = change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'flat';
    var sign = change > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + change.toFixed(1) + '%</span>';
  }

  function fmtMultiple(x) {
    return x === null || x === undefined ? '—' : x.toFixed(3) + '×';
  }

  // -- hash state -----------------------------------------------------------

  function readState() {
    var hash = window.location.hash.replace(/^#/, '');
    if (hash.indexOf('/p/') === 0) return { view: 'detail', slug: hash.slice(3) };
    var query = hash.indexOf('?') === -1 ? '' : hash.slice(hash.indexOf('?') + 1);
    var params = new URLSearchParams(query);
    return {
      view: hash.indexOf('/live') === 0 ? 'live' : 'board',
      q: params.get('q') || '',
      cat: params.get('cat') || '',
      chain: params.get('chain') || '',
      watch: params.get('watch') === '1',
      min: Number(params.get('min') || 0),
      sort: params.get('sort') || 'rank',
      dir: params.get('dir') || 'asc',
    };
  }

  function writeState(state) {
    if (state.view === 'detail') {
      window.location.hash = '/p/' + state.slug;
      return;
    }
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.cat) params.set('cat', state.cat);
    if (state.chain) params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.min) params.set('min', String(state.min));
    if (state.sort && state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir && state.dir !== 'asc') params.set('dir', state.dir);
    var base = state.view === 'live' ? '/live' : '/';
    var qs = params.toString();
    window.location.hash = qs ? base + '?' + qs : base;
  }

  // -- shared chrome --------------------------------------------------------

  function renderMeta() {
    var meta = document.getElementById('masthead-meta');
    meta.innerHTML =
      'snapshot as of <b>' + esc(DATA.as_of) + '</b><br>' +
      'watchlist floor <b>' + esc(fmtUsd(DATA.floor_usd)) + '</b> TVL<br>' +
      '<b>' + DATA.scanned + '</b> protocols scanned';
    var foot = document.getElementById('colophon');
    foot.innerHTML =
      '<b>How to read this board.</b> A protocol on it records no token with DefiLlama as of the snapshot date; ' +
      'that is a statement about the record, not proof none exists. The implied value is this radar\'s own claim: ' +
      'what a launch would be worth if the protocol\'s record stayed as it is. It is not a prediction that a token ' +
      'will be issued, or when. Figures: ' + esc(DATA.source) + '.';
  }

  function statsStrip() {
    var watchOnBoard = DATA.rows.filter(function (r) { return r.watchlist; }).length;
    return (
      '<section class="stats">' +
      '<div class="stat"><div class="k">Protocols scanned</div><div class="v">' + DATA.scanned + '</div>' +
      '<div class="s">every protocol at $5M TVL or more</div></div>' +
      '<div class="stat"><div class="k">Ranked, no token yet</div><div class="v"><em>' + DATA.ranked + '</em></div>' +
      '<div class="s">pre-token candidates, all sizes</div></div>' +
      '<div class="stat"><div class="k">Watchlist covered</div><div class="v">' + watchOnBoard + ' / ' + DATA.watchlist_size + '</div>' +
      '<div class="s">the house floor, $50M and up</div></div>' +
      '<div class="stat"><div class="k">Already trading</div><div class="v">' + DATA.live_size + '</div>' +
      '<div class="s">set aside — they price the model</div></div>' +
      '<div class="stat"><div class="k">Market multiple</div><div class="v">' + DATA.global_multiple.toFixed(3) + '×</div>' +
      '<div class="s">median market cap per $1 of TVL</div></div>' +
      '</section>'
    );
  }

  function methodStrip() {
    return (
      '<section class="method"><b>How the board is priced.</b> Protocols whose token already trades show what the ' +
      'market pays per dollar of TVL; the board takes that multiple — the median for the protocol\'s own category ' +
      'where at least five traded peers report a cap, the market median of <b>' + DATA.global_multiple.toFixed(3) +
      '×</b> elsewhere — and adjusts it for the week\'s momentum, the years run with no token recorded, and the ' +
      'chains reached: <span class="formula">implied value = TVL × multiple × momentum × seasoning × reach</span>. ' +
      'No name is priced by hand; open any row to see its own arithmetic.</section>'
    );
  }

  // -- the yardstick: the multiples the board is priced from ------------------

  function yardstickStrip() {
    var cats = Object.keys(DATA.category_multiples).sort(function (a, b) {
      var byPeers = (DATA.category_evidence[b] || 0) - (DATA.category_evidence[a] || 0);
      return byPeers !== 0 ? byPeers : DATA.category_multiples[b] - DATA.category_multiples[a];
    });
    var priced = {};
    var fallbackRows = 0;
    DATA.rows.forEach(function (r) {
      if (DATA.category_multiples[r.category] === undefined) fallbackRows++;
      else priced[r.category] = (priced[r.category] || 0) + 1;
    });
    var body = cats.map(function (cat) {
      return (
        '<tr><td>' + esc(cat) + '</td>' +
        '<td class="num">' + DATA.category_multiples[cat].toFixed(3) + '×</td>' +
        '<td class="num">' + (DATA.category_evidence[cat] || 0) + '</td>' +
        '<td class="num">' + (priced[cat] || 0) + '</td></tr>'
      );
    }).join('');
    return (
      '<section class="yardstick"><h3>The yardstick — the multiples behind the board</h3>' +
      '<p>Every implied value on this board starts from one of these multiples: the median market cap per ' +
      'TVL dollar among the traded protocols in the same category, taken from the snapshot itself. A ' +
      'category earns its own multiple at five or more traded peers with a reported cap; every other row ' +
      'is priced at the market median instead.</p>' +
      '<table><thead><tr><th>Category</th><th class="num">Multiple</th><th class="num">Traded peers</th>' +
      '<th class="num">Board rows priced from it</th></tr></thead><tbody>' + body +
      '<tr class="fallback"><td>Every other category</td><td class="num">' + DATA.global_multiple.toFixed(3) +
      '×</td><td class="num">—</td><td class="num">' + fallbackRows + '</td></tr>' +
      '</tbody></table></section>'
    );
  }

  // -- the board --------------------------------------------------------------

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function chainNames() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function options(values, current, allLabel) {
    var html = '<option value="">' + allLabel + '</option>';
    values.forEach(function (v) {
      html += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    return html;
  }

  function controls(state, shown) {
    var mins = [0, 10e6, 25e6, 50e6, 100e6, 500e6];
    var minOptions = mins.map(function (m) {
      return '<option value="' + m + '"' + (m === state.min ? ' selected' : '') + '>' +
        (m === 0 ? 'Any TVL' : fmtUsd(m) + '+') + '</option>';
    }).join('');
    return (
      '<div class="controls">' +
      '<span class="viewtoggle">' +
      '<button data-view="board" class="' + (state.view === 'board' ? 'on' : '') + '">Pre-token board</button>' +
      '<button data-view="live" class="' + (state.view === 'live' ? 'on' : '') + '">Already trading</button>' +
      '</span>' +
      '<input type="search" id="f-q" placeholder="Search name, category, chain…" value="' + esc(state.q) + '">' +
      '<select id="f-cat">' + options(categories(), state.cat, 'All categories') + '</select>' +
      '<select id="f-chain">' + options(chainNames(), state.chain, 'All chains') + '</select>' +
      '<select id="f-min">' + minOptions + '</select>' +
      '<label class="check"><input type="checkbox" id="f-watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count-note">' + shown + ' shown</span>' +
      '</div>'
    );
  }

  function filteredRows(state) {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.min && r.tvl_usd < state.min) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  var BOARD_SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_years === null ? -Infinity : r.age_years; },
    value: function (r) { return r.implied_value_usd; },
  };

  function sortRows(rows, state) {
    var key = BOARD_SORTS[state.sort] ? state.sort : 'rank';
    var dir = state.dir === 'desc' ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      var va = BOARD_SORTS[key](a);
      var vb = BOARD_SORTS[key](b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.rank - b.rank;
    });
  }

  function headerCell(state, key, label, cls) {
    var sorted = state.sort === key;
    var arrow = sorted ? (state.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return '<th class="' + (cls || '') + (sorted ? ' sorted' : '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
  }

  function boardView(state) {
    var rows = sortRows(filteredRows(state), state);
    var body = rows.map(function (r) {
      return (
        '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (r.watchlist ? '<span class="tag">WATCHLIST</span>' : '') +
        '<span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains-cell"><span class="chains">' + esc(r.chains.slice(0, 3).join(', ')) +
        (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + (r.age_years === null ? '—' : r.age_years.toFixed(1) + 'y') + '</td>' +
        '<td class="num">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '</tr>'
      );
    }).join('');
    app.innerHTML =
      statsStrip() + methodStrip() + yardstickStrip() + controls(state, rows.length) +
      '<table class="board"><thead><tr>' +
      headerCell(state, 'rank', '#') +
      headerCell(state, 'name', 'Protocol') +
      '<th class="chains-cell">Chains</th>' +
      headerCell(state, 'tvl', 'TVL', 'num') +
      headerCell(state, 'change', '7d', 'num') +
      headerCell(state, 'age', 'No-token age', 'num') +
      headerCell(state, 'value', 'Implied value', 'num') +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="7">No protocol matches those filters.</td></tr>') +
      '</tbody></table>';
    app.setAttribute('aria-busy', 'false');
    wireControls(state);
  }

  // -- the set-aside view: tokens that already trade ---------------------------

  function liveView(state) {
    var rows = DATA.live.slice();
    var key = { name: 1, tvl: 1, mcap: 1, multiple: 1 }[state.sort] ? state.sort : 'mcap';
    var dir = state.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var va = key === 'name' ? a.name.toLowerCase() : key === 'tvl' ? a.tvl_usd : key === 'mcap' ? (a.mcap_usd || 0) : (a.multiple || 0);
      var vb = key === 'name' ? b.name.toLowerCase() : key === 'tvl' ? b.tvl_usd : key === 'mcap' ? (b.mcap_usd || 0) : (b.multiple || 0);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    var body = rows.map(function (r) {
      return (
        '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="num">' + esc(r.symbol || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num">' + fmtMultiple(r.multiple) + '</td></tr>'
      );
    }).join('');
    var liveState = Object.assign({}, state, { sort: key, dir: dir === 1 ? 'asc' : 'desc' });
    app.innerHTML =
      statsStrip() +
      '<section class="method"><b>Set aside, and why they matter.</b> These ' + DATA.live_size + ' protocols already ' +
      'have a token trading, so no launch is coming; the largest ' + DATA.live.length + ' by market cap are listed here. ' +
      'They are the radar\'s evidence: the multiples in the last column are what the market pays per dollar of TVL, ' +
      'and the pre-token board is priced from their median.</section>' +
      controls(liveState, rows.length) +
      '<table class="board"><thead><tr>' +
      headerCell(liveState, 'name', 'Protocol') +
      '<th class="num">Symbol</th>' +
      headerCell(liveState, 'tvl', 'TVL', 'num') +
      headerCell(liveState, 'mcap', 'Market cap', 'num') +
      headerCell(liveState, 'multiple', 'Cap / TVL', 'num') +
      '</tr></thead><tbody>' + body + '</tbody></table>';
    app.setAttribute('aria-busy', 'false');
    wireControls(state);
  }

  // -- one protocol's detail ----------------------------------------------------

  function detailView(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) {
      app.innerHTML = '<p class="note">No ranked protocol by that name. <a class="backlink" href="#/">Back to the board</a></p>';
      return;
    }
    var f = row.factors;
    var ownMultiple = DATA.category_multiples[row.category] !== undefined;
    var steps = row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    app.innerHTML =
      '<a class="backlink" href="#/">← the board</a>' +
      '<div class="detail-head"><h2>' + esc(row.name) + '</h2>' +
      (row.watchlist ? '<span class="tag">WATCHLIST</span>' : '') +
      '<span class="rankline">rank #' + row.rank + ' of ' + DATA.ranked + ' · ' + esc(row.category || 'Uncategorised') +
      ' · ' + esc(row.chains.join(', ')) + '</span></div>' +
      '<p class="note" style="margin-top:0">DefiLlama records no token for ' + esc(row.name) + ' as of ' + esc(DATA.as_of) +
      '. Its implied value below is what a launch would be worth if that record stayed as it is.</p>' +
      '<section class="detail-grid">' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + fmtUsd(row.tvl_usd) + '</div><div class="s">total value locked</div></div>' +
      '<div class="stat"><div class="k">7-day TVL change</div><div class="v">' + (row.change_7d === null ? '—' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%') + '</div><div class="s">the momentum input</div></div>' +
      '<div class="stat"><div class="k">Tracked since</div><div class="v">' + (row.listed_at || '—') + '</div><div class="s">' + (row.age_years === null ? 'age unreported' : row.age_years.toFixed(1) + ' years with no token') + '</div></div>' +
      '<div class="stat"><div class="k">Chains</div><div class="v">' + row.chains.length + '</div><div class="s">' + esc(row.chains.slice(0, 4).join(', ')) + '</div></div>' +
      '<div class="stat"><div class="k">Implied value</div><div class="v"><em>' + fmtUsd(row.implied_value_usd) + '</em></div><div class="s">if the record stayed as it is</div></div>' +
      '</section>' +
      '<section class="derivation"><h3>How this value is derived</h3><table>' +
      '<tr><td>TVL</td><td class="x">' + fmtUsd(row.tvl_usd) + '</td><td>the snapshot\'s figure</td></tr>' +
      '<tr><td>× category multiple</td><td class="x">' + f.multiple.toFixed(3) + '</td><td>' +
      (ownMultiple
        ? 'median cap per TVL dollar among the ' + (DATA.category_evidence[row.category] || 0) + ' traded ' + esc(row.category) + ' protocols in the snapshot'
        : 'the market median — too few traded peers in this category to price it alone') + '</td></tr>' +
      '<tr><td>× momentum</td><td class="x">' + f.momentum.toFixed(3) + '</td><td>from the 7-day TVL change of ' +
      (row.change_7d === null ? 'unreported, taken as neutral' : row.change_7d.toFixed(1) + '%') + '</td></tr>' +
      '<tr><td>× seasoning</td><td class="x">' + f.seasoning.toFixed(3) + '</td><td>for ' +
      (row.age_years === null ? 'an unreported age, taken as neutral' : row.age_years.toFixed(1) + ' years run with no token recorded') + '</td></tr>' +
      '<tr><td>× reach</td><td class="x">' + f.reach.toFixed(3) + '</td><td>for ' + row.chains.length + (row.chains.length === 1 ? ' chain' : ' chains') + '</td></tr>' +
      '<tr class="total"><td>implied launch value</td><td class="x">' + fmtUsd(row.implied_value_usd) + '</td><td></td></tr>' +
      '</table></section>' +
      '<section class="plan"><h3>The farm plan</h3><ol>' + steps + '</ol></section>';
    app.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }

  // -- wiring -------------------------------------------------------------------

  function wireControls(state) {
    var q = document.getElementById('f-q');
    if (q) {
      q.addEventListener('change', function () {
        writeState(Object.assign({}, state, { q: q.value }));
      });
      q.addEventListener('keydown', function (e) { if (e.key === 'Enter') q.blur(); });
    }
    var cat = document.getElementById('f-cat');
    if (cat) cat.addEventListener('change', function () { writeState(Object.assign({}, state, { cat: cat.value })); });
    var chain = document.getElementById('f-chain');
    if (chain) chain.addEventListener('change', function () { writeState(Object.assign({}, state, { chain: chain.value })); });
    var min = document.getElementById('f-min');
    if (min) min.addEventListener('change', function () { writeState(Object.assign({}, state, { min: Number(min.value) })); });
    var watch = document.getElementById('f-watch');
    if (watch) watch.addEventListener('change', function () { writeState(Object.assign({}, state, { watch: watch.checked })); });
    Array.prototype.forEach.call(document.querySelectorAll('.viewtoggle button'), function (button) {
      button.addEventListener('click', function () {
        writeState(Object.assign({}, state, { view: button.getAttribute('data-view'), sort: 'rank', dir: 'asc' }));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        var next = Object.assign({}, state, { sort: key });
        next.dir = state.sort === key && state.dir === 'asc' ? 'desc' : 'asc';
        writeState(next);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        writeState({ view: 'detail', slug: tr.getAttribute('data-slug') });
      });
    });
  }

  function render() {
    var state = readState();
    if (state.view === 'detail') detailView(state.slug);
    else if (state.view === 'live') liveView(state);
    else boardView(state);
  }

  renderMeta();
  window.addEventListener('hashchange', render);
  render();
})();
