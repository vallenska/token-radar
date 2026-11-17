/* Token Radar / ORBIT, a static instrument panel over window.TOKEN_RADAR.
   No network, no framework, no build step: data.js, this file and app.css are the whole page. */
(function () {
  'use strict';

  var DATA = window.TOKEN_RADAR;
  var app = document.getElementById('app');
  if (!DATA || !Array.isArray(DATA.rows)) {
    app.textContent = 'The radar data did not load. Run main.ts to write data.js beside dashboard/.';
    return;
  }

  var state = {
    tab: 'radar', q: '', category: 'all', chain: 'all', minTvl: 0, momentum: 'all',
    watch: false, sort: 'implied', dir: -1, selected: null, liveSort: 'mcap', liveDir: -1
  };

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, String(value));
      });
    }
    for (var index = 2; index < arguments.length; index += 1) {
      var child = arguments[index];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (item) {
          if (item !== null && item !== undefined) node.appendChild(item);
        });
      } else if (typeof child === 'string' || typeof child === 'number') {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function money(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    var abs = Math.abs(value);
    if (abs >= 1e12) return '$' + (value / 1e12).toFixed(2).replace(/\.?0+$/, '') + 'T';
    if (abs >= 1e9) return '$' + (value / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (abs >= 1e6) return '$' + (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return '$' + Math.round(value / 1e3) + 'K';
    return '$' + Math.round(value);
  }

  function exact(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    return '$' + Math.round(value).toLocaleString('en-US');
  }

  function percent(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  }

  function ageLabel(days, known) {
    if (!known || days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 365) return '1.0y';
    if (days >= 30) return Math.round(days / 30) + 'mo';
    return Math.round(days) + 'd';
  }

  function chainText(chains) {
    if (!chains || chains.length === 0) return 'unnamed chain';
    return chains.slice(0, 3).join(' / ') + (chains.length > 3 ? ' +' + (chains.length - 3) : '');
  }

  function categoryOf(row) { return row.category || 'Other'; }

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var params = new URLSearchParams(raw);
    var tab = params.get('tab');
    if (tab === 'radar' || tab === 'live' || tab === 'method') state.tab = tab;
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) {
      var min = Number(params.get('minTvl'));
      if (isFinite(min) && min > 0) state.minTvl = min;
    }
    if (params.get('momentum')) state.momentum = params.get('momentum');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('sort')) {
      state.sort = params.get('sort');
      state.dir = params.get('dir') === '1' ? 1 : -1;
    }
    if (params.get('p')) state.selected = params.get('p');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.tab !== 'radar') params.set('tab', state.tab);
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl > 0) params.set('minTvl', String(state.minTvl));
    if (state.momentum !== 'all') params.set('momentum', state.momentum);
    if (state.watch) params.set('watch', '1');
    if (state.sort !== 'implied') {
      params.set('sort', state.sort);
      params.set('dir', state.dir === 1 ? '1' : '-1');
    }
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var query = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (row) {
      if (state.category !== 'all' && categoryOf(row) !== state.category) return false;
      if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl > 0 && row.tvl_usd < state.minTvl) return false;
      if (state.watch && !row.on_watchlist) return false;
      if (state.momentum === 'up' && !(row.change_7d !== null && row.change_7d > 0)) return false;
      if (state.momentum === 'down' && !(row.change_7d !== null && row.change_7d < 0)) return false;
      if (state.momentum === 'hot' && !(row.change_7d !== null && row.change_7d >= 10)) return false;
      if (!query) return true;
      var haystack = [row.name, row.slug, row.category || '', row.symbol || '', (row.chains || []).join(' ')].join(' ').toLowerCase();
      return haystack.indexOf(query) >= 0;
    });
  }

  function sortValue(row, key) {
    if (key === 'rank') return row.rank;
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d === null ? -Infinity : row.change_7d;
    if (key === 'age') return row.age_known ? row.age_days : Infinity;
    if (key === 'signal') return row.signal;
    return row.implied_value_usd;
  }

  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      var left = sortValue(a, state.sort);
      var right = sortValue(b, state.sort);
      if (left < right) return -state.dir;
      if (left > right) return state.dir;
      return a.rank - b.rank;
    });
  }

  function tabButton(tab, label) {
    return el('button', {
      type: 'button',
      'aria-current': state.tab === tab ? 'page' : null,
      text: label,
      onclick: function () {
        if (dialog.open) dialog.close();
        state.tab = tab;
        state.selected = null;
        writeHash();
        render();
      }
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'orbit-mark', 'aria-hidden': 'true' }),
        el('div', { class: 'brand-copy' },
          el('span', { class: 'brand-name', text: 'Token Radar' }),
          el('span', { class: 'brand-sub', text: 'ORBIT / pre-token intelligence' })
        )
      ),
      el('div', { class: 'top-right' },
        el('nav', { class: 'nav', 'aria-label': 'Views' },
          tabButton('radar', 'Radar'),
          tabButton('live', 'Live benchmarks'),
          tabButton('method', 'Method')
        ),
        el('div', { class: 'top-meta' },
          el('span', { text: 'SNAPSHOT ' + DATA.as_of }),
          el('span', { text: DATA.watchlist_size + ' WATCHLIST' }),
          el('span', { text: DATA.board_size + ' ROWS' }),
          el('span', { text: DATA.model_version.toUpperCase() })
        )
      )
    );
  }

  function radarHero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', null,
        el('div', { class: 'eyebrow' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), 'Launch radar / ' + DATA.board_size + ' protocols with no token on record'),
        el('h1', null, 'Find the token ', el('span', { class: 'grad', text: 'before the ticker.' })),
        el('p', { class: 'hero-copy' },
          'ORBIT ranks each protocol by the multiple its sector already trades at, then adjusts for ',
          el('b', { text: '7-day momentum, years without a token, and chain reach' }),
          '. The ' + DATA.watchlist_size + '-protocol house watchlist is covered in full; ' + DATA.early_size + ' early candidates sit below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor.'
        ),
        el('div', { class: 'hero-actions' },
          el('button', { class: 'button primary', type: 'button', text: 'Open the ranked board', onclick: function () { document.getElementById('board-host').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }),
          el('button', { class: 'button', type: 'button', text: 'How ORBIT works', onclick: function () { state.tab = 'method'; writeHash(); render(); } })
        )
      ),
      el('aside', { class: 'snapshot', 'aria-label': 'Snapshot summary' },
        el('div', { class: 'snapshot-label', text: 'Top implied value' }),
        el('div', { class: 'snapshot-top' }, el('b', { text: money(top.implied_value_usd) }), el('span', { text: '#' + top.rank })),
        el('div', { class: 'snapshot-name', text: top.name + ' · ' + categoryOf(top) }),
        el('div', { class: 'kpis' },
          el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', null, DATA.watchlist_size + ' / ' + DATA.watchlist_size)),
          el('div', { class: 'kpi' }, el('span', { text: 'Ranked launch rows' }), el('b', { text: String(DATA.board_size) })),
          el('div', { class: 'kpi' }, el('span', { text: 'Early below floor' }), el('b', { text: String(DATA.early_size) })),
          el('div', { class: 'kpi' }, el('span', { text: 'Calibration protocols' }), el('b', { text: String(DATA.peers.total_samples) }))
        )
      )
    );
  }

  function categoryOptions() {
    var seen = {};
    DATA.rows.forEach(function (row) { seen[categoryOf(row)] = true; });
    return Object.keys(seen).sort();
  }

  function chainOptions() {
    var counts = {};
    DATA.rows.forEach(function (row) {
      (row.chains || []).forEach(function (chain) { counts[chain] = (counts[chain] || 0) + 1; });
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0); });
  }

  function selectField(id, label, value, options, onChange) {
    var select = el('select', { id: id, 'aria-label': label }, options.map(function (option) {
      return el('option', { value: option.value, text: option.label, selected: String(option.value) === String(value) ? 'selected' : null });
    }));
    select.addEventListener('change', function () { onChange(select.value); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
  }

  function toolbar() {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, chain or category', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); refreshBoard(); });
    var categories = categoryOptions().map(function (category) { return { value: category, label: category }; });
    var chains = chainOptions().map(function (chain) { return { value: chain, label: chain }; });
    var watch = el('input', { type: 'checkbox', id: 'watch', checked: state.watch ? 'checked' : null });
    watch.addEventListener('change', function () { state.watch = watch.checked; writeHash(); refreshBoard(); });
    var reset = el('button', {
      class: 'reset', type: 'button', text: 'Reset filters',
      onclick: function () {
        state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.momentum = 'all'; state.watch = false;
        writeHash(); render();
      }
    });
    return el('section', { class: 'toolbar', 'aria-label': 'Board filters' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', state.category, [{ value: 'all', label: 'All categories' }].concat(categories), function (value) { state.category = value; writeHash(); refreshBoard(); }),
      selectField('chain', 'Chain', state.chain, [{ value: 'all', label: 'All chains' }].concat(chains), function (value) { state.chain = value; writeHash(); refreshBoard(); }),
      selectField('minTvl', 'Minimum TVL', state.minTvl, [
        { value: 0, label: 'Any TVL' }, { value: 50000000, label: '$50M and up' }, { value: 100000000, label: '$100M and up' },
        { value: 250000000, label: '$250M and up' }, { value: 500000000, label: '$500M and up' }, { value: 1000000000, label: '$1B and up' }
      ], function (value) { state.minTvl = Number(value); writeHash(); refreshBoard(); }),
      selectField('momentum', 'Momentum', state.momentum, [
        { value: 'all', label: 'Any momentum' }, { value: 'up', label: 'Positive 7d' }, { value: 'hot', label: 'Hot: +10% or more' }, { value: 'down', label: 'Negative 7d' }
      ], function (value) { state.momentum = value; writeHash(); refreshBoard(); }),
      el('label', { class: 'check', for: 'watch' }, watch, 'Watchlist only'),
      el('div', { class: 'toolbar-foot' },
        el('span', { class: 'count', id: 'result-count', text: filteredRows().length + ' of ' + DATA.board_size + ' shown' }),
        reset
      )
    );
  }

  function boardSort(key) {
    if (state.sort === key) state.dir = state.dir === 1 ? -1 : 1;
    else {
      state.sort = key;
      state.dir = key === 'name' || key === 'rank' ? 1 : -1;
    }
    writeHash();
    refreshBoard();
  }

  function boardHeader(key, label) {
    return el('th', { scope: 'col' }, el('button', {
      type: 'button', onclick: function () { boardSort(key); }
    }, label, state.sort === key ? el('span', { class: 'arrow', text: state.dir < 0 ? '↓' : '↑' }) : null));
  }

  function growthClass(value) {
    if (value === null || value === undefined) return 'flat';
    if (value > 0) return 'pos';
    if (value < 0) return 'neg';
    return 'flat';
  }

  function boardRow(row, maxImplied) {
    var growth = percent(row.change_7d);
    var signalWidth = Math.max(3, Math.min(100, row.signal));
    var valueWidth = Math.max(3, Math.round((row.implied_value_usd / maxImplied) * 100));
    return el('tr', {
      'data-slug': row.slug,
      'data-selected': state.selected === row.slug ? 'true' : 'false',
      tabindex: '0',
      'aria-label': 'Open the farm plan for ' + row.name,
      onclick: function () { selectRow(row.slug); },
      onkeydown: function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectRow(row.slug);
        }
      }
    },
      el('td', { class: 'rank' }, el('b', { text: String(row.rank) })),
      el('td', { class: 'name-cell' },
        el('div', { class: 'name-line' },
          el('span', { class: 'pill ' + (row.on_watchlist ? 'wl' : 'early'), text: row.on_watchlist ? 'WL' : 'EARLY' }),
          el('b', { text: row.name })
        ),
        el('div', { class: 'name-meta' }, categoryOf(row) + ' · ' + chainText(row.chains))
      ),
      el('td', { class: 'num', text: money(row.tvl_usd) }),
      el('td', { class: 'num ' + growthClass(row.change_7d), text: growth }),
      el('td', { class: 'num', text: ageLabel(row.age_days, row.age_known) }),
      el('td', { class: 'signal-cell' },
        el('div', { class: 'signal' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + signalWidth + '%' })),
          el('b', { text: String(row.signal) })
        )
      ),
      el('td', { class: 'value-cell' },
        el('div', { class: 'value-bar' },
          el('span', { class: 'bar cyan', 'aria-hidden': 'true' }, el('i', { style: 'width:' + valueWidth + '%' })),
          el('span', { class: 'num', text: money(row.implied_value_usd) })
        )
      ),
      el('td', null,
        el('button', {
          class: 'plan-button', type: 'button', text: 'Plan',
          onclick: function (event) { event.stopPropagation(); selectRow(row.slug); }
        })
      )
    );
  }

  function boardPanel() {
    var rows = sortRows(filteredRows());
    if (rows.length === 0) {
      return el('section', { class: 'panel' },
        el('div', { class: 'empty' },
          el('h2', { text: 'No protocol matches those filters' }),
          el('p', { text: 'Clear the search or widen the category, chain, TVL or momentum filter to bring the radar back.' }),
          el('button', {
            class: 'button primary', type: 'button', text: 'Clear filters',
            onclick: function () {
              state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.momentum = 'all'; state.watch = false;
              writeHash(); render();
            }
          })
        )
      );
    }
    var maxImplied = Math.max.apply(null, rows.map(function (row) { return row.implied_value_usd; }));
    var body = el('tbody');
    rows.forEach(function (row) { body.appendChild(boardRow(row, maxImplied)); });
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('div', null,
          el('h2', { text: 'Ranked launch board' }),
          el('p', { text: 'Every row records no token in the snapshot. Rank is ORBIT implied value; signal is a separate 0-100 reading aid.' })
        ),
        el('div', { class: 'legend' },
          el('span', null, el('i', { class: 'mdot' }), 'signal'),
          el('span', null, el('i', { class: 'cdot' }), 'implied value'),
          el('span', null, el('i', { class: 'adot' }), 'WL = house watchlist')
        )
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sr-only', text: 'Pre-token protocols ranked by ORBIT implied value. Sort with the column buttons; activate a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            boardHeader('rank', 'Rank'),
            boardHeader('name', 'Protocol'),
            boardHeader('tvl', 'TVL'),
            boardHeader('growth', '7d'),
            boardHeader('age', 'Age'),
            boardHeader('signal', 'Signal'),
            boardHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Farm' })
          )),
          body
        )
      )
    );
  }

  function refreshBoard() {
    var host = document.getElementById('board-host');
    if (host) {
      host.textContent = '';
      host.appendChild(boardPanel());
    }
    var count = document.getElementById('result-count');
    if (count) count.textContent = filteredRows().length + ' of ' + DATA.board_size + ' shown';
  }

  function modelStrip() {
    return el('section', { class: 'strip' },
      el('article', { class: 'note' },
        el('h3', { text: 'A sector multiple, not a slogan' }),
        el('p', { text: 'Each category is priced from the market-cap/TVL multiple its token-bearing protocols already trade at, shrunk toward the whole market when the sample is thin. No protocol name is special-cased.' })
      ),
      el('article', { class: 'note' },
        el('h3', { text: 'Pre-token and live are not mixed' }),
        el('p', { text: 'The board ranks only protocols whose snapshot record has no market cap, CoinGecko id or symbol. Token-bearing protocols are kept in Live benchmarks as calibration, never as launch rows.' })
      ),
      el('article', { class: 'note' },
        el('h3', { text: 'A model, never a promise' }),
        el('p', { text: 'Implied value is an estimate from frozen data. It does not predict that a token will launch, what it will be worth, or that a farm will pay. Never pay anyone to claim a reward.' })
      )
    );
  }

  function bossRow(row, index) {
    return el('tr', { 'aria-label': row.name + ' live benchmark' },
      el('td', { class: 'rank' }, el('b', { text: String(index + 1) })),
      el('td', { class: 'name-cell' },
        el('div', { class: 'name-line' }, el('b', { text: row.name }), row.symbol ? el('span', { class: 'pill', text: row.symbol }) : null),
        el('div', { class: 'name-meta' }, categoryOf(row) + ' · ' + chainText(row.chains))
      ),
      el('td', { class: 'num', text: money(row.mcap_usd) }),
      el('td', { class: 'num', text: money(row.tvl_usd) }),
      el('td', { class: 'num', text: row.ratio.toFixed(2) + '×' }),
      el('td', { class: 'num ' + growthClass(row.change_7d), text: percent(row.change_7d) })
    );
  }

  function liveTable() {
    var rows = DATA.live.slice().sort(function (a, b) {
      var key = state.liveSort;
      var left = key === 'name' ? a.name.toLowerCase() : key === 'tvl' ? a.tvl_usd : key === 'ratio' ? a.ratio : key === 'growth' ? (a.change_7d === null ? -Infinity : a.change_7d) : a.mcap_usd;
      var right = key === 'name' ? b.name.toLowerCase() : key === 'tvl' ? b.tvl_usd : key === 'ratio' ? b.ratio : key === 'growth' ? (b.change_7d === null ? -Infinity : b.change_7d) : b.mcap_usd;
      if (left < right) return -state.liveDir;
      if (left > right) return state.liveDir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    var body = el('tbody');
    rows.forEach(function (row, index) { body.appendChild(bossRow(row, index)); });
    function liveHeader(key, label) {
      return el('th', { scope: 'col' }, el('button', {
        type: 'button',
        onclick: function () {
          if (state.liveSort === key) state.liveDir = state.liveDir === 1 ? -1 : 1;
          else { state.liveSort = key; state.liveDir = key === 'name' ? 1 : -1; }
          render();
        }
      }, label, state.liveSort === key ? el('span', { class: 'arrow', text: state.liveDir < 0 ? '↓' : '↑' }) : null));
    }
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('div', null,
          el('h2', { text: 'Live token benchmarks' }),
          el('p', { text: 'These protocols already record a token, so their market cap is a fact. They calibrate the multiple; they are not launch rows.' })
        ),
        el('div', { class: 'legend' }, el('span', null, DATA.live_total + ' token-bearing protocols in the snapshot'))
      ),
      el('div', { class: 'table-wrap short' },
        el('table', null,
          el('caption', { class: 'sr-only', text: 'Top token-bearing protocols by market cap, used as calibration comparables.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: '#' }),
            liveHeader('name', 'Protocol'),
            liveHeader('mcap', 'Market cap'),
            liveHeader('tvl', 'TVL'),
            liveHeader('ratio', 'Mcap / TVL'),
            liveHeader('growth', '7d')
          )),
          body
        )
      )
    );
  }

  function sectorTable(limit) {
    var sectors = DATA.peers.sectors.slice(0, limit);
    var body = el('tbody');
    sectors.forEach(function (sector) {
      body.appendChild(el('tr', null,
        el('td', { text: sector.category }),
        el('td', { class: 'num', text: String(sector.samples) }),
        el('td', { class: 'num', text: sector.median_ratio.toFixed(2) + '×' }),
        el('td', { class: 'num', text: sector.multiple.toFixed(3) + '×' })
      ));
    });
    return el('table', { class: 'sector-table' },
      el('caption', { class: 'sr-only', text: 'Sector peer multiples used by ORBIT.' }),
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Sector' }),
        el('th', { scope: 'col', text: 'Live comps' }),
        el('th', { scope: 'col', text: 'Median' }),
        el('th', { scope: 'col', text: 'Applied' })
      )),
      body
    );
  }

  function liveView() {
    return el('div', null,
      el('section', { class: 'live-hero' },
        el('div', null,
          el('div', { class: 'eyebrow' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), 'Live benchmarks / the calibration set'),
          el('h1', null, 'The market multiple, ', el('span', { class: 'grad', text: 'made visible.' })),
          el('p', { text: 'ORBIT reads what token-bearing protocols in the snapshot already trade at. Their market caps are facts, so they sit apart from the launch board and only calibrate the sector multiples.' })
        ),
        el('div', { class: 'live-stat' }, el('b', { text: DATA.peers.global_multiple.toFixed(2) + '×' }), el('span', { text: 'global median mcap / TVL' }))
      ),
      el('div', { class: 'stack' }, liveTable(), el('section', { class: 'card' },
        el('h2', { text: 'Sector calibration' }),
        el('p', { text: 'A category with a deep sample is trusted more; a category with one comparable is shrunk toward the global median with a prior weight of ' + DATA.model.prior_weight + '. Ratios are clipped to ' + DATA.model.ratio_floor + '×–' + DATA.model.ratio_cap + '× before the median.' }),
        sectorTable(100)
      ))
    );
  }

  function factor(label, text) {
    return el('div', { class: 'factor' }, el('b', { text: label }), el('span', { text: text }));
  }

  function methodView() {
    var model = DATA.model;
    var watchRows = DATA.rows.filter(function (row) { return row.on_watchlist; }).sort(function (a, b) { return a.rank - b.rank; });
    return el('div', null,
      el('section', { class: 'method-hero' },
        el('div', { class: 'eyebrow' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), 'Method / ORBIT ' + model.version),
        el('h1', null, 'No names. ', el('span', { class: 'grad', text: 'Just the snapshot.' })),
        el('p', { text: 'ORBIT turns the sealed DefiLlama record into one ranked claim: what a protocol’s token-bearing peers imply its own token could be worth if the record stayed as it is. The model reads TVL, seven-day growth, age without a token, chain reach and the market multiple of the protocol’s own category.' })
      ),
      el('div', { class: 'method-grid' },
        el('section', { class: 'card' },
          el('h2', { text: 'The formula' }),
          el('p', { text: 'One function scores every protocol. The constants below are the model’s whole opinion; there is no per-name override.' }),
          el('div', { class: 'formula' },
            'implied = round( tvl_usd × sector_multiple × (1 + clamp(change_7d, ' + model.growth_floor + ', ' + model.growth_cap + ') / 100 × ' + model.growth_weight + ') × (' + model.maturity_floor + ' + min(age_days, ' + model.maturity_days + ') / ' + model.maturity_days + ' × ' + model.maturity_range + ') × (1 + min(chains - 1, ' + model.chain_cap + ') × ' + model.chain_weight + ') )'
          ),
          el('div', { class: 'factor-list' },
            factor('Sector multiple', 'Shrunken median market-cap / TVL of live protocols in the same category, with prior ' + model.prior_weight + ' toward the global median ' + DATA.peers.global_multiple.toFixed(2) + '×.'),
            factor('7-day growth', 'Clamped to ' + model.growth_floor + '% to +' + model.growth_cap + '%, then given a ' + model.growth_weight + ' weight. A null change is neutral.'),
            factor('Age without token', 'Days since DefiLlama first listed the protocol, capped at ' + model.maturity_days + '. Unknown age uses ' + model.unknown_age_days + ' days.'),
            factor('Chain reach', 'Each additional chain after the first adds ' + (model.chain_weight * 100) + '%, capped at ' + model.chain_cap + ' chains.'),
            factor('Signal score', 'A separate 0-100 blend of TVL rank, momentum, age, chain reach, peer-sample depth and watchlist membership. It never changes implied value.')
          )
        ),
        el('section', { class: 'card' },
          el('h2', { text: 'What is on the board' }),
          el('p', { text: 'The watchlist is the floor, not the ceiling. Every one of its ' + DATA.watchlist_size + ' protocols is covered, plus ' + DATA.early_size + ' clean pre-token protocols below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor.' }),
          el('ul', { class: 'guardrails' },
            el('li', { text: 'A board row records no market cap, no CoinGecko id and no symbol in the snapshot.' }),
            el('li', { text: 'Wrapped, staked, bridged, versioned and exchange-branded products are excluded from the early scan, because they are usually a product of a token that already trades.' }),
            el('li', { text: 'Token-bearing protocols are never mixed into the ranking; they appear only in Live benchmarks and in the sector multiple.' }),
            el('li', { text: 'The dossier recomputes each row from the snapshot fields, so the page and board.json use the same arithmetic.' })
          ),
          el('h3', { style: 'margin-top: 24px', text: 'Watchlist coverage: ' + DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
          el('div', { class: 'watchlist-chips' }, watchRows.map(function (row) { return el('span', { class: 'chip', text: row.name }); }))
        ),
        el('section', { class: 'card' },
          el('h2', { text: 'Sector multiples' }),
          el('p', { text: 'The applied multiple is what ORBIT uses after shrinkage. Median is the raw clipped center of the category’s live comparables.' }),
          sectorTable(24)
        ),
        el('section', { class: 'card' },
          el('h2', { text: 'What this is not' }),
          el('ul', { class: 'guardrails' },
            el('li', { text: 'It is not a prediction that a token will launch, or when.' }),
            el('li', { text: 'It is not a price target, an offer, or investment advice.' }),
            el('li', { text: 'A protocol that records no token may still have one the record does not carry. The snapshot is evidence, not proof.' }),
            el('li', { text: 'A farm plan is a checklist for a reader who already accepts the risk, not a promise of a reward.' }),
            el('li', { text: 'Never pay a fee to claim points or a token. Check the protocol’s own official page before signing anything.' })
          ),
          el('div', { class: 'warning', text: 'The snapshot is frozen at ' + DATA.as_of + '. Re-read the protocol’s own page before funding a position; if its TVL, category or token status has changed, the implied value has changed too.' })
        )
      )
    );
  }

  function footer() {
    return el('footer', { class: 'footer' },
      el('span', { text: DATA.source_note + ' · snapshot ' + DATA.as_of + ' · ORBIT ' + DATA.model_version + ' · ' + DATA.board_size + ' ranked / ' + DATA.watchlist_size + ' watchlist covered' }),
      el('span', { text: 'Implied value is a model, not a price or a promise. A protocol that records no token may still have a token the record does not carry. Never pay to claim.' })
    );
  }

  function updateSelection() {
    var rows = document.querySelectorAll('tr[data-slug]');
    for (var index = 0; index < rows.length; index += 1) {
      rows[index].setAttribute('data-selected', rows[index].getAttribute('data-slug') === state.selected ? 'true' : 'false');
    }
  }

  function selectRow(slug) {
    state.selected = slug;
    writeHash();
    updateSelection();
    showDetail(slug, false);
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    state.selected = null;
    writeHash();
    updateSelection();
  });
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close();
  });
  document.body.appendChild(dialog);

  function splitStep(step) {
    var at = step.indexOf(' Cost: ');
    var action = at >= 0 ? step.slice(0, at) : step;
    var rest = at >= 0 ? step.slice(at + 7) : '';
    var timeAt = rest.indexOf('. Time: ');
    var cost = timeAt >= 0 ? rest.slice(0, timeAt) : rest;
    var time = timeAt >= 0 ? rest.slice(timeAt + 8).replace(/\.$/, '') : '';
    return { action: action, cost: cost, time: time };
  }

  function showDetail(slug, sync) {
    var row = null;
    for (var index = 0; index < DATA.rows.length; index += 1) {
      if (DATA.rows[index].slug === slug) { row = DATA.rows[index]; break; }
    }
    if (!row) { state.selected = null; return; }
    state.selected = slug;
    if (sync) writeHash();
    var category = categoryOf(row);
    var recomputed = Math.max(1, Math.round(row.tvl_usd * row.model.peer_multiple * row.model.growth_multiplier * row.model.maturity_multiplier * row.model.chain_multiplier));
    var peers = DATA.live.filter(function (live) { return categoryOf(live) === category; }).slice(0, 3);
    var steps = row.farm_steps.map(splitStep);

    var head = el('div', { class: 'detail-head' },
      el('div', null,
        el('div', { class: 'detail-kicker' },
          el('span', { class: 'rank-badge', text: 'Rank #' + row.rank }),
          el('span', { text: row.on_watchlist ? 'Watchlist' : 'Early candidate' }),
          el('span', { text: 'No token on record' })
        ),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { text: category + ' · ' + chainText(row.chains) + ' · listed ' + (row.listed_at || 'unknown') })
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', 'aria-label': 'Close details', onclick: function () { dialog.close(); } })
    );

    var left = el('div', { class: 'detail-col' },
      el('div', { class: 'detail-value' }, el('b', { text: exact(row.implied_value_usd) }), el('span', { text: 'IMPLIED VALUE' })),
      el('div', { class: 'detail-note' },
        'Signal ', el('b', { text: row.signal + ' / 100' }), ' · ', row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's'), ' · ',
        row.age_known ? ageLabel(row.age_days, true) + ' without a token' : 'age not reported'
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Model breakdown' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'TVL' }), el('b', { text: exact(row.tvl_usd) })),
          el('div', null, el('span', { text: 'Sector multiple (' + category + ', ' + row.model.peer_samples + ' comps)' }), el('b', { text: row.model.peer_multiple.toFixed(3) + '×' })),
          el('div', null, el('span', { text: '7-day growth ' + percent(row.change_7d) }), el('b', { text: '×' + row.model.growth_multiplier.toFixed(3) })),
          el('div', null, el('span', { text: 'Age without token ' + ageLabel(row.age_days, row.age_known) }), el('b', { text: '×' + row.model.maturity_multiplier.toFixed(3) })),
          el('div', null, el('span', { text: 'Chain reach (' + row.chains.length + ')' }), el('b', { text: '×' + row.model.chain_multiplier.toFixed(3) })),
          el('div', null, el('span', { text: 'ORBIT implied value' }), el('b', { text: exact(row.implied_value_usd) }))
        ),
        el('p', { class: 'detail-note' },
          'The page recomputes this row as ', el('b', { text: exact(recomputed) }),
          recomputed === row.implied_value_usd ? ', matching board.json.' : ', which differs from board.json: the data is stale.'
        )
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Why this rank' }),
        el('p', { class: 'detail-note' },
          category + ' peers trade near ' + row.model.peer_multiple.toFixed(2) + '× TVL. The seven-day move adds a ' + row.model.growth_multiplier.toFixed(2) + ' multiplier, ' + ageLabel(row.age_days, row.age_known) + ' of no-token history adds ' + row.model.maturity_multiplier.toFixed(2) + ', and ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' add ' + row.model.chain_multiplier.toFixed(2) + '.'
        )
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Live comparables in ' + category }),
        peers.length > 0 ? el('div', { class: 'peer-list' }, peers.map(function (peer) {
          return el('div', { class: 'peer' }, el('b', { text: peer.name + (peer.symbol ? ' (' + peer.symbol + ')' : '') }), el('span', { text: peer.ratio.toFixed(2) + '× TVL' }));
        })) : el('p', { class: 'detail-note', text: 'No live comparable in this category, so ORBIT uses the global median ' + DATA.peers.global_multiple.toFixed(2) + '× plus shrinkage.' })
      ),
      el('div', { class: 'warning', text: 'The snapshot records no token for this protocol; that is not proof it has none. Implied value is a model, not a price. Never pay anyone to claim a reward.' })
    );

    var right = el('div', { class: 'detail-col' },
      el('div', { class: 'plan-head' },
        el('h3', { text: 'Farm plan' }),
        el('p', { text: steps.length + ' steps · USD costs · hold window included' })
      ),
      el('ol', { class: 'steps' }, steps.map(function (step) {
        return el('li', null,
          el('p', { text: step.action }),
          el('div', { class: 'step-meta' },
            el('span', { text: 'Cost: ' + step.cost }),
            el('span', { class: 'time', text: 'Time: ' + step.time })
          )
        );
      })),
      el('div', { class: 'warning', text: 'This is a checklist, not a promise of a token or a reward. Size the position so losing it would not change your plans, and check the protocol’s own official page before each transaction.' })
    );

    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-shell' },
      head,
      el('div', { class: 'detail-body' }, left, right),
      el('div', { class: 'detail-foot' },
        el('span', { text: 'ORBIT ' + DATA.model_version + ' · snapshot ' + DATA.as_of }),
        el('span', { text: 'Rank ' + row.rank + ' / ' + DATA.board_size + ' · signal ' + row.signal })
      )
    ));
    if (!dialog.open) dialog.showModal();
  }

  function render() {
    app.setAttribute('aria-busy', 'true');
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    if (state.tab === 'live') {
      shell.appendChild(liveView());
    } else if (state.tab === 'method') {
      shell.appendChild(methodView());
    } else {
      shell.appendChild(radarHero());
      shell.appendChild(toolbar());
      var host = el('div', { id: 'board-host' });
      host.appendChild(boardPanel());
      shell.appendChild(host);
      shell.appendChild(modelStrip());
    }
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) showDetail(state.selected, false);
  }

  readHash();
  render();
})();
