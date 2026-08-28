/* =========================================================
   canvas.js — お絵描き（Pointer Events / 筆圧 / undo / 消しゴム / 色）
   Apple Pencil と指を同じコードで扱う。
   ========================================================= */

var DrawPad = (function () {
  var canvas = null, ctx = null;
  var drawing = false;
  var last = null;              // {x,y,w}
  var strokes = [];             // undo 用のスナップショット（ImageData ではなく dataURL）
  var MAX_UNDO = 12;

  var COLORS = [
    { name: 'くろ',   value: '#222222' },
    { name: 'あか',   value: '#e03131' },
    { name: 'あお',   value: '#1c7ed6' },
    { name: 'きいろ', value: '#f2c53d' },
    { name: 'みどり', value: '#2f9e44' },
    { name: 'ちゃいろ', value: '#8b5a2b' }
  ];

  var state = {
    color: '#222222',
    size: 1,          // 1:細 2:中 3:太
    eraser: false
  };

  var SIZE_BASE = { 1: 3, 2: 7, 3: 14 };

  /* ---------- 初期化 ---------- */
  function init() {
    canvas = $id('drawCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    buildColorButtons();
    bindTools();
    bindPointer();
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('orientationchange', onWindowResize);
  }

  /* 画面幅に合わせて内部解像度を決める（Retina 対応、上限あり） */
  function resize() {
    var wrap = $id('canvasWrap');
    if (!wrap || !canvas) return;
    var cssW = wrap.clientWidth;
    if (!cssW) cssW = 640;
    var ratio = 3 / 4;                      // 4:3 の横長
    var cssH = Math.round(cssW * ratio);
    var maxH = Math.round(window.innerHeight * 0.56);
    if (cssH > maxH && maxH > 200) { cssH = maxH; }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    var prev = null;
    if (canvas.width && canvas.height) {
      try { prev = canvas.toDataURL('image/png'); } catch (e) { prev = null; }
    }

    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cssW, cssH);

    if (prev) {
      var img = new Image();
      img.onload = function () { ctx.drawImage(img, 0, 0, cssW, cssH); };
      img.src = prev;
    }
  }

  var resizeTimer = null;
  function onWindowResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if ($id('s2') && $id('s2').classList.contains('is-active')) resize();
    }, 200);
  }

  /* ---------- 色ボタン ---------- */
  function buildColorButtons() {
    var wrap = $id('colorTools');
    if (!wrap) return;
    wrap.innerHTML = '';
    COLORS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-tool btn-color' + (i === 0 ? ' is-on' : '');
      b.style.background = c.value;
      b.dataset.color = c.value;
      b.setAttribute('aria-label', c.name);
      b.addEventListener('click', function () {
        state.color = c.value;
        state.eraser = false;
        $$('#colorTools .btn-color').forEach(function (x) {
          x.classList.toggle('is-on', x === b);
        });
        $id('btnEraser').classList.remove('is-on');
        beep('tap');
      });
      wrap.appendChild(b);
    });
  }

  /* ---------- 道具 ---------- */
  function bindTools() {
    $$('#sizeTools .btn-tool').forEach(function (b) {
      b.addEventListener('click', function () {
        state.size = parseInt(b.dataset.size, 10);
        $$('#sizeTools .btn-tool').forEach(function (x) {
          x.classList.toggle('is-on', x === b);
        });
        beep('tap');
      });
    });

    $id('btnEraser').addEventListener('click', function () {
      state.eraser = !state.eraser;
      this.classList.toggle('is-on', state.eraser);
      if (state.eraser) {
        $$('#colorTools .btn-color').forEach(function (x) { x.classList.remove('is-on'); });
      }
      beep('tap');
    });

    $id('btnUndo').addEventListener('click', function () { undo(); beep('tap'); });

    $id('btnClear').addEventListener('click', function () {
      pushUndo();
      clear();
      beep('tap');
    });
  }

  /* ---------- undo ---------- */
  function pushUndo() {
    try {
      strokes.push(canvas.toDataURL('image/png'));
      if (strokes.length > MAX_UNDO) strokes.shift();
    } catch (e) { /* 無視 */ }
  }

  function undo() {
    if (!strokes.length) { toast('これ以上もどせません'); return; }
    var data = strokes.pop();
    var img = new Image();
    img.onload = function () {
      var w = parseFloat(canvas.style.width);
      var h = parseFloat(canvas.style.height);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
    };
    img.src = data;
  }

  function clear() {
    var w = parseFloat(canvas.style.width);
    var h = parseFloat(canvas.style.height);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  function reset() {
    strokes = [];
    resize();
    clear();
    state.eraser = false;
    $id('btnEraser').classList.remove('is-on');
  }

  /* ---------- 描画（Pointer Events） ---------- */
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /* 筆圧で太さを変える。
     指やマウスは pressure=0.5 固定で返ってくるので、その場合は基準幅のまま。 */
  function widthOf(e) {
    var base = SIZE_BASE[state.size] * (state.eraser ? 2.6 : 1);
    var p = (typeof e.pressure === 'number' && e.pressure > 0) ? e.pressure : 0.5;
    if (e.pointerType === 'pen') {
      return base * (0.35 + p * 1.5);
    }
    return base;
  }

  function bindPointer() {
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      pushUndo();
      drawing = true;
      var p = pos(e);
      last = { x: p.x, y: p.y, w: widthOf(e) };
      // 点をひとつ打つ（タップだけでも描けるように）
      ctx.beginPath();
      ctx.fillStyle = state.eraser ? '#ffffff' : state.color;
      ctx.arc(p.x, p.y, last.w / 2, 0, Math.PI * 2);
      ctx.fill();
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      e.preventDefault();
      var pts = (e.getCoalescedEvents ? e.getCoalescedEvents() : null) || [e];
      for (var i = 0; i < pts.length; i++) stroke(pts[i]);
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      canvas.addEventListener(ev, function (e) {
        if (!drawing) return;
        drawing = false;
        last = null;
        if (canvas.hasPointerCapture && e.pointerId !== undefined) {
          try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        }
      });
    });

    // iPad の引っぱり更新・スクロールを確実に止める
    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  }

  function stroke(e) {
    var p = pos(e);
    var w = widthOf(e);
    if (!last) { last = { x: p.x, y: p.y, w: w }; return; }
    ctx.strokeStyle = state.eraser ? '#ffffff' : state.color;
    ctx.lineWidth = (last.w + w) / 2;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = { x: p.x, y: p.y, w: w };
  }

  /* ---------- 書き出し ---------- */
  function toDataURL() {
    try {
      // 解答画面での表示用に少し縮めて容量を抑える
      var w = canvas.width, h = canvas.height;
      var maxW = 900;
      if (w <= maxW) return canvas.toDataURL('image/png');
      var off = document.createElement('canvas');
      off.width = maxW;
      off.height = Math.round(h * (maxW / w));
      var octx = off.getContext('2d');
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, off.width, off.height);
      octx.drawImage(canvas, 0, 0, off.width, off.height);
      return off.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  function isBlank() {
    return strokes.length === 0;
  }

  return {
    init: init,
    reset: reset,
    resize: resize,
    toDataURL: toDataURL,
    isBlank: isBlank,
    COLORS: COLORS
  };
})();
