/* Matcha Home. Один рендерер стакана на всё: подоконник в витрине, меню, конструктор.
   Стакан рисуется SVG по рецепту; в конструкторе слои переезжают твином, поверхность
   колышется и затухает. Это единственная постоянно движущаяся вещь на странице. */

(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Состав и цены ----------

  const BASE_PRICE = 290;
  const BASES = {
    none:       { color: null,      price: 0,  adj: 'Классическая', adjM: '' },
    strawberry: { color: '#E8697F', price: 40, adj: 'Клубничная',   adjM: 'Клубничный ' },
    rose:       { color: '#F0A3B4', price: 40, adj: 'Розовая',      adjM: 'Розовый ' },
    mango:      { color: '#F2B24F', price: 40, adj: 'Манговая',     adjM: 'Манговый ' },
    blueberry:  { color: '#7D6AB2', price: 40, adj: 'Черничная',    adjM: 'Черничный ' },
  };
  const MILKS = {
    cow:     { color: '#FBF5EA', price: 0,  text: 'коровье молоко' },
    oat:     { color: '#EEDDBF', price: 40, text: 'овсяное молоко' },
    coconut: { color: '#FFFDF8', price: 50, text: 'кокосовое молоко' },
    tonic:   { color: '#DDEDE1', price: 30, text: 'тоник' },
  };
  const SHOTS = {
    1: { share: .22, color: '#ABC76F', price: 0,   text: '1 шот' },
    2: { share: .32, color: '#8DB045', price: 60,  text: '2 шота' },
    3: { share: .42, color: '#6E962C', price: 120, text: '3 шота' },
  };
  const TOPS = {
    none:  { price: 0,  peak: 70,  c1: '#FFFFFF', c2: '#F3EDE2', text: '' },
    cloud: { price: 60, peak: 42,  c1: '#FFFFFF', c2: '#F1EADF', text: 'сливочное облако' },
    salt:  { price: 60, peak: 52,  c1: '#FAF3E6', c2: '#E8DAC2', text: 'солёные сливки' },
    pink:  { price: 60, peak: 54,  c1: '#FBD7DD', c2: '#F0AEBB', text: 'клубничная пена' },
  };
  const BERRY_PRICE = 30;

  const DEFAULT = { base: 'strawberry', milk: 'cow', shots: '2', top: 'none', temp: 'iced', bow: false, berry: false, dust: false };

  function parseRecipe(str) {
    const q = new URLSearchParams(str || '');
    const r = { ...DEFAULT };
    for (const k of ['base', 'milk', 'shots', 'top', 'temp']) if (q.get(k)) r[k] = q.get(k);
    for (const k of ['bow', 'berry', 'dust']) r[k] = q.get(k) === '1';
    return r;
  }

  const priceOf = r => BASE_PRICE + BASES[r.base].price + MILKS[r.milk].price + SHOTS[r.shots].price
    + TOPS[r.top].price + (r.berry ? BERRY_PRICE : 0);

  const keyOf = r => [r.base, r.milk, r.shots, r.top, r.temp, +r.bow, +r.berry, +r.dust].join('|');

  // ---------- Цвета ----------

  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => {
    const A = hex(a), B = hex(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => 1 - Math.pow(1 - t, 3);

  // ---------- Геометрия стакана ----------

  const RIM = 62, BOTTOM = 256;
  const wallL = y => 31 + (y - RIM) * (19.5 / 189);
  const wallR = y => 169 - (y - RIM) * (19.5 / 189);

  function layoutOf(r) {
    const warm = r.temp === 'warm';
    const y0 = r.top !== 'none' ? 104 : (warm ? 92 : 84);
    const L = BOTTOM - y0;
    const baseH = r.base === 'none' ? 0 : L * (warm ? .12 : .2);
    const matchaH = warm ? L - baseH : L * SHOTS[r.shots].share;
    const milk = MILKS[r.milk].color;
    const matcha = warm ? mix(milk, SHOTS[r.shots].color, .5 + .14 * (r.shots - 1)) : SHOTS[r.shots].color;
    const top = TOPS[r.top];
    return {
      y0, y1: y0 + matchaH, y2: BOTTOM - baseH,
      cMatcha: matcha, cMilk: milk, cBase: BASES[r.base].color || milk,
      peak: top.peak, topOp: r.top === 'none' ? 0 : 1, c1: top.c1, c2: top.c2,
    };
  }

  let uidSeq = 0;
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  // Поверхность жидкости: синус от стенки до стенки, ниже - до дна.
  function surface(y, amp, ph, bottom) {
    let d = `M0 ${(y + amp * Math.sin(ph)).toFixed(2)}`;
    for (let x = 10; x <= 200; x += 10) d += ` L${x} ${(y + amp * Math.sin(x * .055 + ph)).toFixed(2)}`;
    return d + ` L200 ${bottom} L0 ${bottom} Z`;
  }

  function dome(b, p, bumpy) {
    if (!bumpy) return `M24 ${b} C24 ${b - 18} 58 ${p} 100 ${p} C142 ${p} 176 ${b - 18} 176 ${b} Z`;
    return `M24 ${b} C24 ${b - 16} 38 ${p + 12} 56 ${p + 10} C60 ${p - 2} 84 ${p - 6} 100 ${p}`
      + ` C116 ${p - 6} 140 ${p - 2} 144 ${p + 10} C162 ${p + 12} 176 ${b - 16} 176 ${b} Z`;
  }

  class Cup {
    constructor(svg) {
      this.svg = svg;
      const id = 'cup' + (++uidSeq);
      svg.setAttribute('viewBox', '0 -16 200 290');
      svg.setAttribute('xmlns', NS);

      const defs = el('defs', {}, svg);
      const inner = 'M31 62 L169 62 L149.5 251 Q100 259 50.5 251 Z';
      el('path', { d: inner }, el('clipPath', { id: id + 'in' }, defs));
      const cpTop = el('clipPath', { id: id + 'top' }, defs);
      el('path', { d: inner }, cpTop);
      el('rect', { x: 0, y: -20, width: 200, height: 82 }, cpTop);

      const pat = el('pattern', { id: id + 'straw', width: 14, height: 14, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(38)' }, defs);
      el('rect', { width: 14, height: 14, fill: '#FFF6F7' }, pat);
      el('rect', { width: 7, height: 14, fill: '#EC9AAA' }, pat);

      const grad = name => {
        const g = el('linearGradient', { id: id + name, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: 0, y2: 10 }, defs);
        return [el('stop', { offset: 0, 'stop-opacity': 0 }, g), el('stop', { offset: 1, 'stop-opacity': 1 }, g), g];
      };
      this.gMilk = grad('milk');
      this.gBase = grad('base');
      const tg = el('linearGradient', { id: id + 'tg', x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      this.tStops = [el('stop', { offset: 0 }, tg), el('stop', { offset: 1 }, tg)];

      el('ellipse', { class: 'shadow', cx: 100, cy: 262, rx: 60, ry: 6 }, svg);

      // трубочка рисуется первой: погружённая часть уходит под непрозрачное молоко
      this.straw = el('g', { class: 'toggle', transform: 'rotate(9 118 140)' }, svg);
      el('rect', { x: 113, y: -14, width: 12, height: 250, rx: 5, fill: `url(#${id}straw)`, stroke: 'rgba(46,58,28,.25)', 'stroke-width': 1 }, this.straw);

      const liquid = el('g', { 'clip-path': `url(#${id}in)` }, svg);
      this.pMatcha = el('path', {}, liquid);
      this.pMilk = el('path', { fill: `url(#${id}milk)` }, liquid);
      this.pBase = el('path', { fill: `url(#${id}base)` }, liquid);
      this.foam = el('path', { class: 'toggle', fill: '#FFF8EE' }, liquid);

      this.bubbles = el('g', { class: 'bubbles toggle' }, liquid);
      this.bub = Array.from({ length: 14 }, (_, i) => ({
        u: (i * 0.618) % 1, v: (i * 0.377 + .13) % 1, r: 1.3 + (i % 4) * .6,
        n: el('circle', {}, this.bubbles),
      }));

      this.ice = el('g', { class: 'ice toggle' }, liquid);
      [[62, 72, 30, -14], [106, 68, 28, 16], [82, 98, 27, 6], [122, 104, 25, -18]].forEach(([x, y, s, a]) => {
        el('rect', { x, y, width: s, height: s, rx: 6, transform: `rotate(${a} ${x + s / 2} ${y + s / 2})` }, this.ice);
      });

      this.topping = el('path', { fill: `url(#${id}tg)`, stroke: 'rgba(46,58,28,.16)', 'stroke-width': 1.2, 'clip-path': `url(#${id}top)` }, svg);
      this.dust = el('g', { class: 'toggle' }, svg);
      this.dots = Array.from({ length: 18 }, (_, i) => ({
        u: (i * 0.618 + .05) % 1, v: (i * 0.29) % 1,
        n: el('circle', { r: 1.3 + (i % 3) * .35, fill: '#6E962C', opacity: .85 }, this.dust),
      }));

      el('path', { class: 'glass', d: 'M30 61 L51 252 Q100 262 149 252 L170 61' }, svg);
      el('ellipse', { class: 'rim', cx: 100, cy: 61, rx: 70, ry: 6 }, svg);
      el('path', { class: 'shine', d: 'M42 80 L57 236', 'stroke-width': 5, opacity: .45 }, svg);
      el('path', { class: 'shine', d: 'M159 88 L148 226', 'stroke-width': 2, opacity: .35 }, svg);

      this.sleeve = el('g', { class: 'toggle' }, svg);
      el('path', { class: 'sleeve', d: `M${wallL(138) - 1} 138 L${wallR(138) + 1} 138 L${wallR(198) + 1} 198 L${wallL(198) - 1} 198 Z` }, this.sleeve);
      const st = el('text', { class: 'sleeve-text', x: 100, y: 173, 'text-anchor': 'middle' }, this.sleeve);
      st.textContent = 'MATCHA HOME';

      this.steam = el('g', { class: 'steam toggle' }, svg);
      ['M76 40c-9-10 9-16 0-28', 'M100 34c-9-10 9-16 0-28', 'M124 40c-9-10 9-16 0-28'].forEach(d => el('path', { d }, this.steam));

      this.bow = el('use', { class: 'toggle', href: '#bow-shape', transform: 'translate(66 100) scale(.85)' }, svg);

      this.berry = el('g', { class: 'toggle', transform: 'translate(146 36) rotate(20)' }, svg);
      el('path', { d: 'M12 0C20 0 26 6 24 16C22 26 14 34 12 36C10 34 2 26 0 16C-2 6 4 0 12 0Z', fill: '#E64B60', stroke: '#B8334A', 'stroke-width': 1 }, this.berry);
      el('path', { d: 'M3 3L8 -4L12 1L16 -5L21 3Q12 7 3 3Z', fill: '#6C8F3A' }, this.berry);
      [[7, 10], [16, 9], [11, 17], [6, 21], [17, 20], [12, 27]].forEach(([cx, cy]) => el('ellipse', { cx, cy, rx: 1, ry: 1.5, fill: '#FCE7A0' }, this.berry));

      // детали по умолчанию скрыты, чтобы при загрузке ничего не мигало
      svg.querySelectorAll('.toggle').forEach(n => { n.style.opacity = 0; });

      this.cur = null;
      this.amp = 0;
      this.phase = 0;
      this.raf = 0;
    }

    set(r, animate) {
      this.recipe = r;
      const to = layoutOf(r);
      const warm = r.temp === 'warm';
      const show = (n, on) => { n.style.opacity = on ? 1 : 0; };
      show(this.straw, !warm);
      show(this.ice, !warm);
      show(this.bubbles, !warm && r.milk === 'tonic');
      show(this.foam, warm && r.top === 'none');
      show(this.sleeve, warm);
      show(this.steam, warm);
      show(this.bow, r.bow);
      show(this.berry, r.berry);
      show(this.dust, r.dust);

      if (!animate || !this.cur || reduceMotion) {
        this.cur = to;
        this.amp = 0;
        this.render(to);
        return;
      }
      this.from = { ...this.cur };
      this.to = to;
      this.t0 = performance.now() + (this.delay || 0);
      this.dur = this.delay !== undefined ? 1400 : 750;
      this.delay = undefined;
      this.amp = Math.max(this.amp, 5.5);
      if (!this.raf) this.raf = requestAnimationFrame(this.tick.bind(this));
      // страховка: если кадры не идут (фоновая вкладка, экономия энергии), встаём в итог без анимации
      clearTimeout(this.safety);
      this.safety = setTimeout(() => {
        if (this.raf && Date.now() - (this.lastTick || 0) > 400) {
          cancelAnimationFrame(this.raf);
          this.raf = 0;
          this.amp = 0;
          this.cur = this.to;
          this.render(this.to);
        }
      }, Math.max(0, this.t0 - performance.now()) + this.dur + 300);
    }

    // Налить с пустого стакана: слои поднимаются со дна, шапка падает сверху
    pour(r, delay = 0) {
      if (reduceMotion) return this.set(r, false);
      const to = layoutOf(r);
      this.cur = { ...to, y0: BOTTOM - 2, y1: BOTTOM - 1, y2: BOTTOM, topOp: 0, peak: to.peak - 30 };
      this.render(this.cur);
      this.delay = delay;
      this.set(r, true);
    }

    tick(now) {
      this.lastTick = Date.now();
      const t = Math.max(0, Math.min(1, (now - this.t0) / this.dur));
      const k = ease(t);
      const f = this.from, g = this.to, c = {};
      for (const key of ['y0', 'y1', 'y2', 'peak', 'topOp']) c[key] = lerp(f[key], g[key], k);
      for (const key of ['cMatcha', 'cMilk', 'cBase', 'c1', 'c2']) c[key] = mix(f[key], g[key], k);
      this.cur = c;
      this.amp *= .955;
      this.phase += .16;
      this.render(c);
      if (t < 1 || this.amp > .05) this.raf = requestAnimationFrame(this.tick.bind(this));
      else { this.raf = 0; this.amp = 0; this.render(c); }
    }

    render(c) {
      const a = this.amp, ph = this.phase;
      this.pMatcha.setAttribute('d', surface(c.y0, a, ph, 280));
      this.pMatcha.setAttribute('fill', c.cMatcha);
      this.pMilk.setAttribute('d', surface(c.y1, a * .45, ph + 1.3, 280));
      this.pBase.setAttribute('d', surface(c.y2, a * .3, ph + 2.1, 280));
      this.setGrad(this.gMilk, c.cMilk, c.y1, 16);
      this.setGrad(this.gBase, c.cBase, c.y2, 11);
      this.foam.setAttribute('d', surface(c.y0 - 1, a, ph, c.y0 + 9));

      for (const b of this.bub) {
        const y = c.y1 + 12 + b.v * Math.max(0, c.y2 - c.y1 - 20);
        const l = wallL(y) + 10, w = wallR(y) - 10 - l;
        b.n.setAttribute('cx', (l + b.u * w).toFixed(1));
        b.n.setAttribute('cy', y.toFixed(1));
        b.n.setAttribute('r', b.r);
      }
      this.ice.setAttribute('transform', `translate(0 ${(c.y0 - 84 + a * .6 * Math.sin(ph * .7)).toFixed(2)})`);

      const bumpy = this.recipe && this.recipe.top === 'cloud';
      const peak = c.peak - a * .4;
      this.topping.setAttribute('d', dome(c.y0 + 6, peak, bumpy));
      this.topping.style.opacity = c.topOp;
      this.tStops[0].setAttribute('stop-color', c.c1);
      this.tStops[1].setAttribute('stop-color', c.c2);

      const hasTop = c.topOp > .5;
      for (const d of this.dots) {
        const x = 52 + d.u * 96;
        const y = hasTop
          ? peak + 4 + Math.pow((x - 100) / 74, 2) * (c.y0 - peak - 6) + d.v * 4
          : c.y0 + d.v * 3 + a * Math.sin(x * .055 + ph);
        d.n.setAttribute('cx', x.toFixed(1));
        d.n.setAttribute('cy', y.toFixed(1));
      }
    }

    setGrad([s0, s1, g], color, y, feather) {
      g.setAttribute('y1', (y - 1).toFixed(2));
      g.setAttribute('y2', (y + feather).toFixed(2));
      s0.setAttribute('stop-color', color);
      s1.setAttribute('stop-color', color);
    }
  }

  // ---------- Статичные стаканы: подоконник и меню ----------

  document.querySelectorAll('svg.cup[data-recipe]').forEach(svg => {
    new Cup(svg).set(parseRecipe(svg.dataset.recipe), false);
  });

  const menuItems = [...document.querySelectorAll('.drink')].map(li => {
    const r = parseRecipe(li.dataset.recipe);
    new Cup(li.querySelector('svg.cup')).set(r, false);
    return { li, r, key: keyOf(r), name: li.querySelector('h3').textContent };
  });

  // ---------- Конструктор ----------

  const form = document.getElementById('options');
  const stageSvg = document.getElementById('stage-cup');
  const $ = id => document.getElementById(id);

  if (form && stageSvg) {
    const stage = new Cup(stageSvg);
    const radios = name => [...form.querySelectorAll(`input[name="${name}"]`)];

    const read = () => {
      const r = {};
      for (const k of ['base', 'milk', 'shots', 'top', 'temp']) r[k] = form.querySelector(`input[name="${k}"]:checked`).value;
      for (const k of ['bow', 'berry', 'dust']) r[k] = form.querySelector(`input[name="${k}"]`).checked;
      return r;
    };

    const write = r => {
      for (const k of ['base', 'milk', 'shots', 'top', 'temp']) {
        radios(k).forEach(i => { i.checked = i.value === String(r[k]); });
      }
      for (const k of ['bow', 'berry', 'dust']) form.querySelector(`input[name="${k}"]`).checked = !!r[k];
    };

    // Тоник тёплым не бывает: взаимно выключаем
    const lock = r => {
      radios('temp').find(i => i.value === 'warm').disabled = r.milk === 'tonic';
      radios('milk').find(i => i.value === 'tonic').disabled = r.temp === 'warm';
    };

    const nameOf = r => {
      const hit = menuItems.find(m => m.key === keyOf(r));
      if (hit) return { title: hit.name, match: true };
      if (r.milk === 'tonic') {
        const t = (BASES[r.base].adjM + 'матча-тоник');
        return { title: t.charAt(0).toUpperCase() + t.slice(1), match: false };
      }
      return { title: BASES[r.base].adj + ' матча', match: false };
    };

    const lineOf = r => {
      const parts = [SHOTS[r.shots].text, MILKS[r.milk].text];
      if (r.top !== 'none') parts.push(TOPS[r.top].text);
      parts.push(r.temp === 'warm' ? 'тёплая' : 'со льдом');
      const extra = [r.bow && 'бантик', r.berry && 'клубника на краю', r.dust && 'посыпка'].filter(Boolean);
      return parts.concat(extra).join(' · ');
    };

    const codeOf = r => {
      let h = 7;
      for (const ch of keyOf(r)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
      return 'MH-' + String(1000 + (h % 9000)).padStart(4, '0');
    };

    let lastPrice = null;
    // mode: 'still' - сразу, 'slosh' - слои переезжают с волной, 'pour' - налить с нуля
    const update = (mode, delay) => {
      const r = read();
      lock(r);
      if (mode === 'pour') stage.pour(r, delay);
      else stage.set(r, mode === 'slosh');
      const n = nameOf(r);
      $('stage-name').textContent = n.title;
      $('stage-match').hidden = !n.match;
      $('stage-match').textContent = 'есть в меню';
      $('stage-line').textContent = lineOf(r);
      const p = priceOf(r);
      const priceEl = $('stage-price');
      priceEl.textContent = p + ' ₽';
      if (lastPrice !== null && p !== lastPrice) {
        priceEl.classList.remove('is-pop');
        void priceEl.offsetWidth;
        priceEl.classList.add('is-pop');
      }
      lastPrice = p;
      $('stage-code').textContent = codeOf(r);
      stageSvg.setAttribute('aria-label', `${n.title}: ${lineOf(r)}, ${p} рублей`);
    };

    form.addEventListener('change', () => update('slosh'));

    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    $('surprise').addEventListener('click', () => {
      const prev = keyOf(read());
      let r;
      do {
        r = {
          base: pick(Object.keys(BASES)), milk: pick(Object.keys(MILKS)), shots: pick(['1', '2', '3']),
          top: pick(Object.keys(TOPS)), temp: Math.random() < .25 ? 'warm' : 'iced',
          bow: Math.random() < .45, berry: Math.random() < .35, dust: Math.random() < .3,
        };
        if (r.milk === 'tonic') r.temp = 'iced';
      } while (keyOf(r) === prev);
      write(r);
      update('slosh');
    });

    // «Собрать такую» в меню: переносим рецепт и наливаем, пока страница доезжает до конструктора
    menuItems.forEach(m => {
      m.li.querySelector('.drink__try').addEventListener('click', () => {
        write(m.r);
        update('pour', 550);
        document.getElementById('build').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
    });

    update('still');

    // Первый раз, когда стакан попал на экран, он наливается с нуля
    if ('IntersectionObserver' in window && !reduceMotion) {
      const once = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { once.disconnect(); update('pour', 200); }
      }, { threshold: .6 });
      once.observe(stageSvg);
    }
  }

  // ---------- Мини-шапка ----------

  const bar = document.querySelector('.bar');
  const awning = document.querySelector('.awning');
  const onScroll = () => {
    if (bar && awning) bar.classList.toggle('is-on', awning.getBoundingClientRect().bottom < 0);
    revealCheck();
  };

  // ---------- Появление при скролле: IO + ручной расчёт на случай, если IO молчит ----------

  const pending = new Set(document.querySelectorAll('.reveal'));
  const show = n => { n.classList.add('is-in'); pending.delete(n); };
  function revealCheck() {
    if (!pending.size) return;
    const h = window.innerHeight;
    pending.forEach(n => { if (n.getBoundingClientRect().top < h * .92) show(n); });
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    pending.forEach(n => io.observe(n));
  }
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; onScroll(); });
  }, { passive: true });
  setTimeout(revealCheck, 1200);
  onScroll();

  // ---------- Открыто ли сейчас ----------

  const status = $('now-status');
  if (status) {
    const d = new Date();
    const day = d.getDay();
    const weekend = day === 0 || day === 6;
    const open = weekend ? 9 : 8, close = weekend ? 22 : 21;
    const h = d.getHours() + d.getMinutes() / 60;
    const isOpen = h >= open && h < close;
    status.textContent = isOpen ? `открыто до ${close}:00` : `закрыто, откроемся в ${open}:00`;
    status.parentElement.classList.toggle('is-closed', !isOpen);
  }
})();
