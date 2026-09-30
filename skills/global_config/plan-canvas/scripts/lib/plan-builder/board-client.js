(function () {
  var MIN = 0.2, MAX = 2.5;
  document.documentElement.classList.add('js');
  document.querySelectorAll('.board').forEach(function (board) {
    var vp = board.querySelector('.board-viewport');
    var stage = board.querySelector('.board-stage');
    var canvas = board.querySelector('.board-canvas');
    var svg = board.querySelector('.board-edges');
    var readout = board.querySelector('.zoom-readout');
    var scale = 1, space = false, hover = false, drag = null;

    function route(a, b) {
      var A = { l: a.offsetLeft, t: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight };
      var B = { l: b.offsetLeft, t: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight };
      var x1, y1, x2, y2, mx, my;
      if (B.l >= A.l + A.w || A.l >= B.l + B.w) {
        var right = B.l >= A.l + A.w;
        x1 = right ? A.l + A.w : A.l; y1 = A.t + A.h / 2;
        x2 = right ? B.l : B.l + B.w; y2 = B.t + B.h / 2;
        mx = (x1 + x2) / 2;
        return { d: 'M' + x1 + ' ' + y1 + 'H' + mx + 'V' + y2 + 'H' + x2, x: mx, y: (y1 + y2) / 2 };
      }
      var down = B.t >= A.t + A.h;
      x1 = A.l + A.w / 2; y1 = down ? A.t + A.h : A.t;
      x2 = B.l + B.w / 2; y2 = down ? B.t : B.t + B.h;
      my = (y1 + y2) / 2;
      return { d: 'M' + x1 + ' ' + y1 + 'V' + my + 'H' + x2 + 'V' + y2, x: (x1 + x2) / 2, y: my };
    }

    function layout() {
      stage.style.width = canvas.offsetWidth * scale + 'px';
      stage.style.height = canvas.offsetHeight * scale + 'px';
      if (!svg) return;
      svg.setAttribute('width', canvas.offsetWidth);
      svg.setAttribute('height', canvas.offsetHeight);
      svg.querySelectorAll('.edge').forEach(function (g) {
        var a = document.getElementById(g.getAttribute('data-from'));
        var b = document.getElementById(g.getAttribute('data-to'));
        if (!a || !b) return;
        var r = route(a, b);
        g.querySelector('path').setAttribute('d', r.d);
        var label = g.querySelector('text');
        label.setAttribute('x', r.x);
        label.setAttribute('y', r.y - 6);
      });
    }

    function zoomTo(next, cx, cy) {
      next = Math.min(MAX, Math.max(MIN, next));
      var k = next / scale, sx = vp.scrollLeft + cx, sy = vp.scrollTop + cy;
      scale = next;
      canvas.style.transform = 'scale(' + next + ')';
      layout();
      vp.scrollLeft = sx * k - cx;
      vp.scrollTop = sy * k - cy;
      readout.textContent = Math.round(next * 100) + '%';
    }

    function fit() {
      zoomTo(Math.min(1, vp.clientWidth / canvas.offsetWidth, vp.clientHeight / canvas.offsetHeight), 0, 0);
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    }

    board.querySelectorAll('[data-zoom]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-zoom');
        var cx = vp.clientWidth / 2, cy = vp.clientHeight / 2;
        if (mode === 'in') zoomTo(scale * 1.25, cx, cy);
        else if (mode === 'out') zoomTo(scale / 1.25, cx, cy);
        else if (mode === 'fit') fit();
        else { zoomTo(1, 0, 0); vp.scrollLeft = 0; vp.scrollTop = 0; }
      });
    });

    vp.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var r = vp.getBoundingClientRect();
      zoomTo(scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    vp.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.offsetX > vp.clientWidth || e.offsetY > vp.clientHeight) return;
      if (!space && e.target.closest('.bcard')) return;
      drag = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop };
      vp.classList.add('panning');
      vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener('pointermove', function (e) {
      if (!drag) return;
      vp.scrollLeft = drag.l - (e.clientX - drag.x);
      vp.scrollTop = drag.t - (e.clientY - drag.y);
    });
    function endDrag() { drag = null; vp.classList.remove('panning'); }
    vp.addEventListener('pointerup', endDrag);
    vp.addEventListener('pointercancel', endDrag);

    board.addEventListener('mouseenter', function () { hover = true; });
    board.addEventListener('mouseleave', function () { hover = false; });
    document.addEventListener('keydown', function (e) {
      if (e.code !== 'Space' || !hover || e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
      space = true;
      vp.classList.add('space');
      e.preventDefault();
    });
    document.addEventListener('keyup', function (e) {
      if (e.code !== 'Space') return;
      space = false;
      vp.classList.remove('space');
    });

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(layout);
      ro.observe(canvas);
      board.querySelectorAll('.bcard').forEach(function (c) { ro.observe(c); });
    }
    window.addEventListener('resize', layout);
    fit();
  });
})();
