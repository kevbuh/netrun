// ── Pixel Pet System ──
(function() {
  const PET_FPS = 20;
  const G = 16; // pixel grid size
  const CPX = 32; // canvas element pixels
  const S = CPX / G; // scale factor (2)

  // ── Pet type definitions ──
  const PET_TYPES = {
    cat: {
      outline: '#2a2a2a', body: '#e8a87c', dark: '#c4855c', inner: '#d4846a', eye: '#2a2a2a',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, E = this.eye;
        // Ears
        px(4,3,O); px(5,2,O); px(6,3,O); px(5,3,I);
        px(9,3,O); px(10,2,O); px(11,3,O); px(10,3,I);
        // Head
        for(let x=4;x<=11;x++) px(x,4,O);
        px(3,5,O); px(12,5,O); px(3,6,O); px(12,6,O); px(3,7,O); px(12,7,O);
        for(let x=4;x<=11;x++) px(x,8,O);
        for(let y=5;y<=7;y++) for(let x=4;x<=11;x++) px(x,y,B);
        // Eyes + nose
        if(o.blink){px(6,6,D);px(10,6,D)} else{px(6,6,E);px(10,6,E)}
        px(8,7,I);
        // Tired eyes
        if(o.tired && !o.blink){px(6,5,D);px(10,5,D)}
        if(o.sleeping){
          for(let x=3;x<=12;x++)px(x,9,O); for(let x=4;x<=11;x++)px(x,9,B);
          for(let x=3;x<=12;x++)px(x,10,O);
          px(12,8,D);px(13,8,D);px(13,7,D); return;
        }
        if(o.sitting){
          px(4,9,O);px(11,9,O); for(let x=5;x<=10;x++)px(x,9,B);
          for(let x=4;x<=11;x++)px(x,10,O);
          px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);
          px(12,9,D);px(13,9,D);px(13,8,D); return;
        }
        // Body
        for(let y=9;y<=11;y++){px(4,y,O);px(11,y,O);for(let x=5;x<=10;x++)px(x,y,B);}
        // Legs
        if(o.legFrame===1){px(5,12,O);px(6,12,O);px(9,12,O);px(10,12,O);px(5,13,O);px(10,13,O)}
        else{px(4,12,O);px(5,12,O);px(10,12,O);px(11,12,O);px(4,13,O);px(11,13,O)}
        px(12,10,D);px(13,9,D);px(14,9,D);
      }
    },
    dog: {
      outline: '#3a2a1a', body: '#c49a6c', dark: '#a07848', inner: '#dbb88c', eye: '#2a2a2a',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, E = this.eye;
        // Floppy ears
        px(3,4,O);px(4,3,O);px(5,3,O);px(3,5,O);px(3,6,D);px(4,4,D);
        px(12,4,O);px(11,3,O);px(10,3,O);px(12,5,O);px(12,6,D);px(11,4,D);
        // Head
        for(let x=5;x<=10;x++)px(x,3,O);
        px(4,4,O);px(11,4,O);px(4,5,O);px(11,5,O);px(4,6,O);px(11,6,O);
        for(let x=5;x<=10;x++)px(x,7,O);
        for(let y=4;y<=6;y++)for(let x=5;x<=10;x++)px(x,y,B);
        if(o.blink){px(6,5,D);px(9,5,D)}else{px(6,5,E);px(9,5,E)}
        px(7,6,O);px(8,6,O); // nose
        if(o.tired && !o.blink){px(6,4,D);px(9,4,D)}
        if(o.sleeping){
          for(let x=4;x<=11;x++)px(x,8,O);for(let x=5;x<=10;x++)px(x,8,B);
          for(let x=4;x<=11;x++)px(x,9,O);
          px(12,7,D);px(13,6,D);px(13,5,D);return;
        }
        if(o.sitting){
          px(4,8,O);px(11,8,O);for(let x=5;x<=10;x++)px(x,8,B);
          for(let x=4;x<=11;x++)px(x,9,O);
          px(4,10,O);px(5,10,O);px(10,10,O);px(11,10,O);
          px(12,8,D);px(13,7,D);px(14,7,D);return;
        }
        for(let y=8;y<=10;y++){px(4,y,O);px(11,y,O);for(let x=5;x<=10;x++)px(x,y,B);}
        if(o.legFrame===1){px(5,11,O);px(6,11,O);px(9,11,O);px(10,11,O);px(5,12,O);px(10,12,O)}
        else{px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);px(4,12,O);px(11,12,O)}
        // tail wagging
        if(o.legFrame===1){px(12,9,D);px(13,8,D);px(14,7,D)}
        else{px(12,9,D);px(13,9,D);px(14,8,D)}
      }
    },
    bunny: {
      outline: '#4a4a4a', body: '#eee', dark: '#ccc', inner: '#f5b0b0', eye: '#2a2a2a',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, E = this.eye;
        // Tall ears
        px(5,0,O);px(5,1,O);px(5,2,O);px(6,0,O);px(6,1,I);px(6,2,I);px(6,3,O);
        px(9,0,O);px(9,1,O);px(9,2,O);px(10,0,O);px(10,1,I);px(10,2,I);px(10,3,O);
        // Head
        for(let x=4;x<=11;x++)px(x,4,O);
        px(3,5,O);px(12,5,O);px(3,6,O);px(12,6,O);px(3,7,O);px(12,7,O);
        for(let x=4;x<=11;x++)px(x,8,O);
        for(let y=5;y<=7;y++)for(let x=4;x<=11;x++)px(x,y,B);
        if(o.blink){px(6,6,D);px(10,6,D)}else{px(6,6,E);px(10,6,E)}
        px(8,7,I);
        if(o.tired && !o.blink){px(6,5,D);px(10,5,D)}
        if(o.sleeping){
          for(let x=4;x<=11;x++)px(x,9,O);for(let x=5;x<=10;x++)px(x,9,B);
          for(let x=4;x<=11;x++)px(x,10,O);
          px(12,9,B);px(13,9,B);return;
        }
        if(o.sitting){
          px(4,9,O);px(11,9,O);for(let x=5;x<=10;x++)px(x,9,B);
          for(let x=4;x<=11;x++)px(x,10,O);
          px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);
          px(12,9,B);px(13,9,B);return;
        }
        for(let y=9;y<=11;y++){px(4,y,O);px(11,y,O);for(let x=5;x<=10;x++)px(x,y,B);}
        if(o.legFrame===1){px(5,12,O);px(6,12,O);px(9,12,O);px(10,12,O)}
        else{px(4,12,O);px(5,12,O);px(10,12,O);px(11,12,O)}
        px(12,10,B);px(13,10,B);
      }
    },
    froog: {
      outline: '#7a1a1a', body: '#ef4444', dark: '#dc2626', face: '#c084fc', eye: '#fff', lid: '#ef4444',
      draw(px, o) {
        const B=this.body, D=this.dark, F=this.face, O=this.outline, W=this.eye, L=this.lid;
        const hi='#f87171';
        // ── Big chubby blob (rows 1-13, uses full width) ──
        for(let x=5;x<=10;x++)px(x,1,B);px(4,1,O);px(11,1,O);
        for(let x=3;x<=12;x++)px(x,2,B);px(2,2,O);px(13,2,O);
        for(let x=2;x<=13;x++)px(x,3,B);px(1,3,O);px(14,3,O);
        for(let y=4;y<=10;y++){px(0,y,O);px(15,y,O);for(let x=1;x<=14;x++)px(x,y,B);}
        for(let x=1;x<=14;x++)px(x,11,B);px(0,11,O);px(15,11,O);
        for(let x=2;x<=13;x++)px(x,12,B);px(1,12,O);px(14,12,O);
        for(let x=3;x<=12;x++)px(x,13,O);
        // Highlight
        px(10,2,hi);px(11,2,hi);px(12,2,hi);px(11,3,hi);px(12,3,hi);px(13,3,hi);px(12,4,hi);px(13,4,hi);
        // ── Purple face — big and round ──
        for(let x=4;x<=11;x++)px(x,3,F);
        for(let x=3;x<=12;x++)px(x,4,F);
        for(let x=2;x<=12;x++)px(x,5,F);
        for(let x=2;x<=12;x++)px(x,6,F);
        for(let x=2;x<=12;x++)px(x,7,F);
        for(let x=2;x<=12;x++)px(x,8,F);
        for(let x=3;x<=11;x++)px(x,9,F);
        for(let x=4;x<=10;x++)px(x,10,F);
        for(let x=5;x<=9;x++)px(x,11,F);
        // ── Eyes: 2x2 white, pupils shift with eyeDir ──
        if(!o.blink){
          const ed = o.eyeDir || 'center';
          const eyes = [[4,5],[9,5]];
          eyes.forEach(([ex,ey])=>{
            px(ex,ey,W);px(ex+1,ey,W);px(ex,ey+1,W);px(ex+1,ey+1,W);
            if(ed==='up'){px(ex,ey,'#000');px(ex+1,ey,'#000');}
            else if(ed==='down'){px(ex,ey+1,'#000');px(ex+1,ey+1,'#000');}
            else if(ed==='left'){px(ex,ey,'#000');px(ex,ey+1,'#000');}
            else if(ed==='right'){px(ex+1,ey,'#000');px(ex+1,ey+1,'#000');}
            else{px(ex,ey,'#000');px(ex+1,ey,'#000');}
          });
        }
        // Tired droopy eyes
        if(o.tired && !o.blink){px(4,5,L);px(5,5,L);px(9,5,L);px(10,5,L);}
        // ── Smiley mouth ──
        px(4,8,O);px(5,9,O);px(6,9,O);px(7,9,O);px(8,9,O);px(9,9,O);px(10,9,O);px(11,8,O);
        if(o.sleeping){
          for(let x=2;x<=13;x++)px(x,13,B);px(1,13,O);px(14,13,O);
          for(let x=2;x<=13;x++)px(x,14,O);
          return;
        }
        if(o.sitting){
          px(2,13,D);px(3,13,D);px(4,13,D);px(11,13,D);px(12,13,D);px(13,13,D);
          px(2,14,O);px(3,14,O);px(12,14,O);px(13,14,O);
          return;
        }
        // ── Stubby legs ──
        if(o.legFrame===1){
          px(1,13,D);px(2,13,D);px(3,13,D);px(4,13,D);
          px(11,13,D);px(12,13,D);px(13,13,D);px(14,13,D);
          px(1,14,O);px(2,14,O);px(3,14,O);px(12,14,O);px(13,14,O);px(14,14,O);
        }else{
          px(2,13,D);px(3,13,D);px(4,13,D);px(5,13,D);
          px(10,13,D);px(11,13,D);px(12,13,D);px(13,13,D);
          px(2,14,O);px(3,14,O);px(4,14,O);px(11,14,O);px(12,14,O);px(13,14,O);
        }
      }
    },
    blackCat: {
      outline: '#111', body: '#1a1a1a', dark: '#000', inner: '#333', eye: '#7cfc00', nose: '#444',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, E = this.eye, N = this.nose;
        // Ears — pointy
        px(4,2,O); px(5,1,O); px(6,2,O); px(5,2,I);
        px(9,2,O); px(10,1,O); px(11,2,O); px(10,2,I);
        // Head
        for(let x=4;x<=11;x++) px(x,3,O);
        px(3,4,O); px(12,4,O); px(3,5,O); px(12,5,O); px(3,6,O); px(12,6,O);
        for(let x=4;x<=11;x++) px(x,7,O);
        for(let y=4;y<=6;y++) for(let x=4;x<=11;x++) px(x,y,B);
        // Eyes — green glow
        if(o.blink){px(6,5,I);px(10,5,I)} else{px(6,5,E);px(10,5,E)}
        px(8,6,N);
        if(o.tired && !o.blink){px(6,4,I);px(10,4,I)}
        if(o.sleeping){
          for(let x=3;x<=12;x++)px(x,8,O); for(let x=4;x<=11;x++)px(x,8,B);
          for(let x=3;x<=12;x++)px(x,9,O);
          px(12,7,I);px(13,7,I);px(13,6,I); return;
        }
        if(o.sitting){
          px(4,8,O);px(11,8,O); for(let x=5;x<=10;x++)px(x,8,B);
          for(let x=4;x<=11;x++)px(x,9,O);
          px(4,10,O);px(5,10,O);px(10,10,O);px(11,10,O);
          // Tail curls up when sitting
          px(12,8,I);px(13,8,I);px(14,7,I);px(14,6,I); return;
        }
        // Body
        for(let y=8;y<=10;y++){px(4,y,O);px(11,y,O);for(let x=5;x<=10;x++)px(x,y,B);}
        // Legs
        if(o.legFrame===1){px(5,11,O);px(6,11,O);px(9,11,O);px(10,11,O);px(5,12,O);px(10,12,O)}
        else{px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);px(4,12,O);px(11,12,O)}
        // Tail
        px(12,9,I);px(13,9,I);px(14,8,I);
      }
    },
    poodle: {
      outline: '#994400', body: '#E87830', dark: '#CC6020', inner: '#F5A060', eye: '#2a2a2a', nose: '#222', puff: '#F09048',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, E = this.eye, N = this.nose, P = this.puff;
        // Poofy head — cloud of curls
        px(5,1,P);px(6,1,P);px(9,1,P);px(10,1,P);
        px(4,2,P);px(5,2,P);px(6,2,P);px(7,2,P);px(8,2,P);px(9,2,P);px(10,2,P);px(11,2,P);
        px(3,3,P);px(4,3,P);px(11,3,P);px(12,3,P);
        // Head
        for(let x=4;x<=11;x++) px(x,4,O);
        px(3,4,O); px(12,4,O);
        px(3,5,O); px(12,5,O); px(3,6,O); px(12,6,O); px(3,7,O); px(12,7,O);
        for(let x=4;x<=11;x++) px(x,8,O);
        for(let y=5;y<=7;y++) for(let x=4;x<=11;x++) px(x,y,B);
        // Floppy ear poofs
        px(2,5,P);px(2,6,P);px(3,5,P);px(3,6,P);
        px(12,5,P);px(12,6,P);px(13,5,P);px(13,6,P);
        // Eyes + nose
        if(o.blink){px(6,6,D);px(10,6,D)} else{px(6,6,E);px(10,6,E)}
        px(8,7,N);
        if(o.tired && !o.blink){px(6,5,D);px(10,5,D)}
        if(o.sleeping){
          for(let x=4;x<=11;x++)px(x,9,O); for(let x=5;x<=10;x++)px(x,9,B);
          for(let x=4;x<=11;x++)px(x,10,O);
          // Poof tail
          px(12,9,P);px(13,8,P);px(13,9,P); return;
        }
        if(o.sitting){
          px(4,9,O);px(11,9,O); for(let x=5;x<=10;x++)px(x,9,B);
          for(let x=4;x<=11;x++)px(x,10,O);
          // Poofy feet
          px(3,10,P);px(4,11,P);px(5,11,P);px(10,11,P);px(11,11,P);px(12,10,P);
          // Poof tail
          px(12,9,P);px(13,8,P);px(13,9,P);px(14,8,P); return;
        }
        // Slim body
        for(let y=9;y<=10;y++){px(4,y,O);px(11,y,O);for(let x=5;x<=10;x++)px(x,y,B);}
        // Thin legs with poofy feet
        if(o.legFrame===1){
          px(5,11,O);px(6,11,O);px(9,11,O);px(10,11,O);
          px(4,12,P);px(5,12,P);px(6,12,P);px(9,12,P);px(10,12,P);px(11,12,P);
        } else {
          px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);
          px(3,12,P);px(4,12,P);px(5,12,P);px(10,12,P);px(11,12,P);px(12,12,P);
        }
        // Poof tail
        px(12,9,P);px(13,8,P);px(14,8,P);px(13,9,P);
      }
    },
    pacman: {
      outline: '#b8860b', body: '#ffd700', dark: '#e6c200', eye: '#2a2a2a',
      draw(px, o) {
        const B = this.body, D = this.dark, O = this.outline, E = this.eye;
        const mouthOpen = (o.legFrame === 1);
        // Build a set of mouth-hole pixels to skip when mouth is open
        const skip = new Set();
        if (mouthOpen) {
          // Wedge cut from right side: rows 5-9, deeper toward center at row 7
          [12,11,10].forEach(x => skip.add(x+',7'));
          [12,11].forEach(x => { skip.add(x+',6'); skip.add(x+',8'); });
          [12].forEach(x => { skip.add(x+',5'); skip.add(x+',9'); });
        }
        const mpx = (x,y,c) => { if (!skip.has(x+','+y)) px(x,y,c); };
        // Circle outline + fill (rows 2-12, centered around x=7.5, y=7)
        // Row 2
        for(let x=6;x<=9;x++) mpx(x,2,O);
        // Row 3
        mpx(4,3,O); mpx(5,3,O); mpx(10,3,O); mpx(11,3,O);
        for(let x=5;x<=10;x++) mpx(x,3,B);
        // Row 4
        mpx(3,4,O); mpx(12,4,O);
        for(let x=4;x<=11;x++) mpx(x,4,B);
        // Rows 5-9: widest part
        for(let y=5;y<=9;y++) {
          mpx(2,y,O); mpx(13,y,O);
          for(let x=3;x<=12;x++) mpx(x,y,B);
        }
        // Row 10
        mpx(3,10,O); mpx(12,10,O);
        for(let x=4;x<=11;x++) mpx(x,10,B);
        // Row 11
        mpx(4,11,O); mpx(5,11,O); mpx(10,11,O); mpx(11,11,O);
        for(let x=5;x<=10;x++) mpx(x,11,B);
        // Row 12
        for(let x=6;x<=9;x++) mpx(x,12,O);
        // Eye
        if (!o.blink) { px(9,4,E); px(10,4,E); }
        if (o.tired && !o.blink) { px(9,3,D); px(10,3,D); }
        // Mouth outline edges when open
        if (mouthOpen) {
          px(13,5,O); px(12,5,O);
          px(13,9,O); px(12,9,O);
          px(11,6,O); px(11,8,O);
          px(10,7,O);
        } else {
          // Closed mouth - horizontal line
          for(let x=9;x<=13;x++) px(x,7,O);
        }
        // Sleeping zzz
        if (o.sleeping) return;
        // Dots being eaten (when walking/running)
        if (!o.sitting && !o.sleeping) {
          px(15,7,'#ffb8b8');
        }
      }
    },
  };

  function getPetType() {
    let t = localStorage.getItem('pixelPetType') || 'cat';
    if (t === 'frog') { t = 'froog'; localStorage.setItem('pixelPetType', t); }
    if (t === 'bird') { t = 'cat'; localStorage.setItem('pixelPetType', t); }
    return t;
  }

  // ── Particles ──
  function drawParticle(ctx, type, x, y, frame) {
    const s = S;
    if (type === 'heart') {
      const py = y - (frame % 10) * 0.6;
      ctx.globalAlpha = 1 - (frame % 10) / 10;
      // Bigger, brighter heart
      ctx.fillStyle = '#ff3b5c';
      // Row 0: two dots
      ctx.fillRect((x)*s,(py)*s,s*2,s); ctx.fillRect((x+3)*s,(py)*s,s*2,s);
      // Row 1: full bar
      ctx.fillRect((x-1)*s,(py+1)*s,s*7,s);
      // Row 2: slightly narrower
      ctx.fillRect((x)*s,(py+2)*s,s*5,s);
      // Row 3
      ctx.fillRect((x+1)*s,(py+3)*s,s*3,s);
      // Row 4: tip
      ctx.fillRect((x+2)*s,(py+4)*s,s,s);
      ctx.globalAlpha = 1;
    } else if (type === 'zzz') {
      ctx.fillStyle = '#888';
      const off = frame % 3;
      ctx.font = `${5+off*2}px monospace`;
      ctx.globalAlpha = 0.5+off*0.15;
      ctx.fillText('z', x*s, (y-off*3)*s);
      ctx.globalAlpha = 1;
    }
  }

  // ── State machine ──
  let petState = 'idle', prevBaseState = 'idle';
  let petX = 200, petY = 400;
  let petTargetX = 300, petTargetY = 400;
  let petDir = 1;
  let petFrame = 0;
  let petEyeDir = 'center', petEyeTimer = 0;
  let petStateTimer = 0, petTempTimer = 0;
  let _petLoop = null;
  let _lastActivity = Date.now();
  let _lastScrollY = 0, _scrollSpeed = 0;
  let _mouseX = -1, _mouseY = -1;
  let _fleeTimer = 0;

  // ── Drag state ──
  let _dragging = false;
  let _dragOffX = 0, _dragOffY = 0;
  let _dragPrevState = 'idle';

  function isTired() {
    return Date.now() - _lastActivity > 60000; // tired after 1min idle
  }

  function pickTarget() {
    const w = window.innerWidth, h = window.innerHeight;
    const margin = 20;
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { petTargetX = margin + Math.random() * (w - margin * 2); petTargetY = margin + Math.random() * (h * 0.15); }
    else if (edge === 1) { petTargetX = margin + Math.random() * (w - margin * 2); petTargetY = h - margin - Math.random() * (h * 0.15); }
    else if (edge === 2) { petTargetX = margin + Math.random() * (w * 0.15); petTargetY = margin + Math.random() * (h - margin * 2); }
    else { petTargetX = w - margin - Math.random() * (w * 0.15); petTargetY = margin + Math.random() * (h - margin * 2); }
    if (Math.random() < 0.2) {
      petTargetX = margin + Math.random() * (w - margin * 2);
      petTargetY = margin + Math.random() * (h - margin * 2);
    }
  }

  // ── Pixelated pet bed (drawn behind pet in sidebar mode) ──
  function drawPetBed(ctx) {
    const s = S;
    const bed = '#6B4226';    // dark brown frame
    const bedL = '#8B5E3C';   // lighter brown
    const cush = '#c0392b';   // red cushion
    const cushL = '#e74c3c';  // lighter red highlight
    const cushD = '#a93226';  // darker red shadow

    // Bed base — rounded rectangle frame (rows 12-15, cols 1-14)
    // Back rim (row 11)
    for(let x=2;x<=13;x++) { ctx.fillStyle=bed; ctx.fillRect(x*s,11*s,s,s); }
    // Left/right walls (rows 12-13)
    for(let y=12;y<=14;y++) {
      ctx.fillStyle=bed; ctx.fillRect(1*s,y*s,s,s); ctx.fillRect(14*s,y*s,s,s);
      ctx.fillStyle=bedL; ctx.fillRect(2*s,y*s,s,s); ctx.fillRect(13*s,y*s,s,s);
    }
    // Front rim (row 15)
    for(let x=1;x<=14;x++) { ctx.fillStyle=bed; ctx.fillRect(x*s,15*s,s,s); }

    // Cushion fill (rows 12-14, cols 3-12)
    for(let y=12;y<=14;y++) {
      for(let x=3;x<=12;x++) {
        ctx.fillStyle = (y===12) ? cushL : (y===14) ? cushD : cush;
        ctx.fillRect(x*s,y*s,s,s);
      }
    }
  }

  // ── Shadow drawing ──
  function drawShadow(ctx, yOff, floating) {
    const cx = CPX / 2;
    const baseY = 15; // grid row for shadow
    const ry = floating ? 1.5 : 2;
    const rx = floating ? 5 : 6;
    const alpha = floating ? 0.15 : 0.2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, (baseY + 1) * S, rx * S, ry * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function petTick() {
    petFrame++;
    // Skip movement when dragging
    if (_dragging) {
      drawPetFree();
      return;
    }

    // Eye direction follows mouse
    if (--petEyeTimer <= 0) {
      if (_mouseX >= 0 && Math.random() < 0.85) {
        const el = document.getElementById('pixel-pet');
        const ex = petX + (el ? el.offsetWidth / 2 : 0);
        const ey = petY + (el ? el.offsetHeight / 2 : 0);
        const dx = _mouseX - ex, dy = _mouseY - ey;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) petEyeDir = dx < 0 ? 'left' : 'right';
        else if (Math.abs(dy) > Math.abs(dx) * 1.2) petEyeDir = dy < 0 ? 'up' : 'down';
        else petEyeDir = 'center';
      } else {
        const dirs = ['center','left','right','up','down'];
        petEyeDir = dirs[Math.floor(Math.random() * dirs.length)];
      }
      petEyeTimer = 5 + Math.floor(Math.random() * 10);
    }
    const now = Date.now();
    const idleMs = now - _lastActivity;

    // Temporary state expiry
    if (['happy','run','read','celebrate'].includes(petState)) {
      petTempTimer--;
      if (petTempTimer <= 0) petState = prevBaseState;
    }

    // Sleep after 2min idle
    if (petState !== 'happy' && idleMs > 120000 && petState !== 'sleep') {
      prevBaseState = petState; petState = 'sleep';
    }

    // Scroll reactions
    if (petState !== 'happy' && petState !== 'sleep') {
      if (_scrollSpeed > 30) {
        if (petState !== 'run') prevBaseState = ['run','read'].includes(petState) ? prevBaseState : petState;
        petState = 'run'; petTempTimer = PET_FPS * 2;
      } else if (_scrollSpeed > 3) {
        if (petState !== 'read') prevBaseState = petState === 'read' ? prevBaseState : petState;
        petState = 'read'; petTempTimer = PET_FPS * 2;
      }
    }
    _scrollSpeed *= 0.9;

    // Mouse hover → happy (free mode)
    if (_mouseX >= 0 && petState !== 'sleep' && petState !== 'happy') {
      const el = document.getElementById('pixel-pet');
      if (el) {
        const rect = el.getBoundingClientRect();
        if (_mouseX >= rect.left && _mouseX <= rect.right && _mouseY >= rect.top && _mouseY <= rect.bottom) {
          prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
          petState = 'happy';
          petTempTimer = PET_FPS * 2;
        }
      }
    }

    // Base state cycling
    if (['idle','walk','sit'].includes(petState)) {
      petStateTimer--;
      if (petStateTimer <= 0) {
        if (petState === 'idle') {
          if (Math.random() < 0.4) {
            petState = 'sit';
            petStateTimer = PET_FPS * (5 + Math.random() * 8);
          } else {
            petState = 'walk'; pickTarget();
            petStateTimer = PET_FPS * (2 + Math.random() * 3);
          }
        } else if (petState === 'walk') {
          petState = Math.random() > 0.3 ? 'sit' : 'idle';
          petStateTimer = PET_FPS * (5 + Math.random() * 8);
        } else {
          petState = 'idle';
          petStateTimer = PET_FPS * (4 + Math.random() * 6);
        }
        prevBaseState = petState;
      }
    }

    // 2D movement
    if (petState === 'walk' || petState === 'run') {
      const speed = petState === 'run' ? 5 : 0.6;
      const dx = petTargetX - petX, dy = petTargetY - petY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < speed) {
        petX = petTargetX; petY = petTargetY;
        if (petState === 'walk') {
          petState = 'idle'; petStateTimer = PET_FPS * (2+Math.random()*3); prevBaseState = 'idle';
        }
      } else {
        petDir = dx > 0 ? 1 : -1;
        petX += (dx/dist) * speed;
        petY += (dy/dist) * speed;
      }
    }

    // Bounds
    petX = Math.max(70, Math.min(window.innerWidth - 60, petX));
    petY = Math.max(20, Math.min(window.innerHeight - 60, petY));

    drawPetFree();
  }

  function drawPetFree() {
    const container = document.getElementById('pixel-pet');
    const canvas = document.getElementById('pet-canvas');
    if (!container || !canvas) return;

    container.style.left = petX + 'px';
    container.style.top = petY + 'px';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CPX, CPX);

    const legFrame = (petState === 'walk' || petState === 'run') ? (Math.floor(petFrame / 3) % 2) : 0;
    const blink = petState === 'sleep' || (petState === 'idle' && petFrame % 48 < 3);
    const sitting = petState === 'sit' || petState === 'read';
    const sleeping = petState === 'sleep';
    const jump = ((petState === 'happy' || petState === 'celebrate') && (petFrame % 6 < 3));
    const tired = isTired() && !sleeping && petState !== 'happy';
    const floating = _dragging;
    const yOff = floating ? -3 : (jump ? -2 : (sleeping ? 2 : (sitting ? 1 : 0)));

    // Shadow only when dragging
    if (floating) drawShadow(ctx, yOff, true);

    ctx.save();
    if (petDir === -1) { ctx.translate(CPX, 0); ctx.scale(-1, 1); }

    const pet = PET_TYPES[getPetType()] || PET_TYPES.cat;
    // Wobble animation when dragged
    if (floating) {
      const wobble = Math.sin(petFrame * 0.4) * 2;
      ctx.translate(CPX/2, CPX/2);
      ctx.rotate(wobble * Math.PI / 180 * 3);
      ctx.translate(-CPX/2, -CPX/2);
    }
    const pxFn = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * S, (y + yOff) * S, S, S);
    };
    pet.draw(pxFn, { blink, legFrame: floating ? (Math.floor(petFrame/2)%2) : legFrame, sitting: floating ? false : sitting, sleeping: floating ? false : sleeping, jump, eyeDir: petEyeDir, tired });

    ctx.restore();

    if (petState === 'happy') drawParticle(ctx, 'heart', 1, 2, petFrame);
    if (petState === 'celebrate') {
      // Multiple hearts for celebration
      drawParticle(ctx, 'heart', -1, 3, petFrame);
      drawParticle(ctx, 'heart', 10, 2, petFrame + 5);
      drawParticle(ctx, 'heart', 4, 0, petFrame + 10);
    }
    if (petState === 'sleep') drawParticle(ctx, 'zzz', 12, 2, petFrame);
  }

  function getPetMode() { return localStorage.getItem('pixelPetMode') || 'free'; }

  function isSidebarMode() { return getPetMode() === 'sidebar'; }

  // ── Sidebar mode drawing ──
  function sidebarTick() {
    petFrame++;
    if (_dragging) {
      // In sidebar drag mode, update the free-floating container instead
      drawPetFree();
      return;
    }
    // Eye direction follows mouse in sidebar too
    if (--petEyeTimer <= 0) {
      if (_mouseX >= 0 && Math.random() < 0.85) {
        const el = document.getElementById('pixel-pet-sidebar');
        if (el) {
          const rect = el.getBoundingClientRect();
          const ex = rect.left + rect.width / 2;
          const ey = rect.top + rect.height / 2;
          const dx = _mouseX - ex, dy = _mouseY - ey;
          if (Math.abs(dx) > Math.abs(dy) * 1.2) petEyeDir = dx < 0 ? 'left' : 'right';
          else if (dy > Math.abs(dx) * 1.2) petEyeDir = 'down';
          else petEyeDir = 'center';
        }
      } else {
        const dirs = ['center','left','right','down'];
        petEyeDir = dirs[Math.floor(Math.random() * dirs.length)];
      }
      petEyeTimer = 5 + Math.floor(Math.random() * 10);
    }
    const now = Date.now();
    const idleMs = now - _lastActivity;

    if (['happy','run','celebrate'].includes(petState)) {
      petTempTimer--;
      if (petTempTimer <= 0) petState = prevBaseState;
    }
    if (petState !== 'happy' && idleMs > 120000 && petState !== 'sleep') {
      prevBaseState = petState; petState = 'sleep';
    }
    // Mouse hover → happy (sidebar mode)
    if (_mouseX >= 0 && petState !== 'sleep' && petState !== 'happy') {
      const el = document.getElementById('pixel-pet-sidebar');
      if (el) {
        const rect = el.getBoundingClientRect();
        if (_mouseX >= rect.left && _mouseX <= rect.right && _mouseY >= rect.top && _mouseY <= rect.bottom) {
          prevBaseState = ['idle','sit'].includes(petState) ? petState : prevBaseState;
          petState = 'happy';
          petTempTimer = PET_FPS * 2;
        }
      }
    }

    if (['idle','sit'].includes(petState)) {
      petStateTimer--;
      if (petStateTimer <= 0) {
        petState = petState === 'idle' ? 'sit' : 'idle';
        petStateTimer = PET_FPS * (4 + Math.random() * 6);
        prevBaseState = petState;
      }
    }

    const canvas = document.getElementById('pet-canvas-sb');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CPX, CPX);

    // Draw pet bed behind the pet
    drawPetBed(ctx);

    const blink = petState === 'sleep' || (petState === 'idle' && petFrame % 48 < 3);
    const sitting = petState === 'sit' || petState === 'read';
    const sleeping = petState === 'sleep';
    const jump = (petState === 'happy' || petState === 'celebrate') && (petFrame % 6 < 3);
    const tired = isTired() && !sleeping && petState !== 'happy' && petState !== 'celebrate';
    const yOff = jump ? -2 : (sleeping ? 2 : (sitting ? 1 : 0));

    const pet = PET_TYPES[getPetType()] || PET_TYPES.cat;
    const pxFn = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * S, (y + yOff) * S, S, S);
    };
    pet.draw(pxFn, { blink, legFrame: 0, sitting, sleeping, jump, eyeDir: petEyeDir, tired });

    if (petState === 'happy') drawParticle(ctx, 'heart', 1, 2, petFrame);
    if (petState === 'celebrate') {
      drawParticle(ctx, 'heart', -1, 3, petFrame);
      drawParticle(ctx, 'heart', 10, 2, petFrame + 5);
      drawParticle(ctx, 'heart', 4, 0, petFrame + 10);
    }
    if (petState === 'sleep') drawParticle(ctx, 'zzz', 12, 2, petFrame);
  }

  // ── Drag handling (free mode) ──
  function onDragStart(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const container = document.getElementById('pixel-pet');
    if (!container) return;
    _dragging = true;
    _dragPrevState = petState;
    _dragOffX = e.clientX - petX;
    _dragOffY = e.clientY - petY;
    container.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function _isOverSidebar(x, y) {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return false;
    const r = nav.getBoundingClientRect();
    return x >= r.left - 5 && x <= r.right + 5 && y >= r.top - 5 && y <= r.bottom + 5;
  }

  function _showSidebarDropHint(show) {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;
    if (show) nav.style.outline = '2px solid var(--accent)';
    else nav.style.outline = '';
  }

  function onDragMove(e) {
    if (!_dragging) return;
    petX = e.clientX - _dragOffX;
    petY = e.clientY - _dragOffY;
    // Allow dragging into sidebar zone
    petX = Math.max(0, Math.min(window.innerWidth - 60, petX));
    petY = Math.max(20, Math.min(window.innerHeight - 60, petY));
    _showSidebarDropHint(_isOverSidebar(e.clientX, e.clientY));
  }

  function onDragEnd(e) {
    if (!_dragging) return;
    _dragging = false;
    _showSidebarDropHint(false);
    const container = document.getElementById('pixel-pet');
    if (container) container.style.cursor = 'grab';
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);

    // Dropped on sidebar → switch to sidebar mode
    if (_isOverSidebar(e.clientX, e.clientY)) {
      window.setPixelPetMode('sidebar');
      return;
    }

    petTargetX = petX;
    petTargetY = petY;
    petState = _dragPrevState;
    petStateTimer = PET_FPS * 2;
  }

  // ── Drag handling (sidebar mode — reorder within sidebar, pull out if dragged away) ──
  let _sbDragFloating = false;
  let _sbDragReordering = false;
  let _sbDragGhost = null;
  let _sbDragStartY = 0;

  function onSidebarDragStart(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    _dragPrevState = petState;
    _sbDragStartY = e.clientY;
    _sbDragFloating = false;
    _sbDragReordering = false;
    _dragging = false;

    const sbEl = document.getElementById('pixel-pet-sidebar');
    const rect = sbEl ? sbEl.getBoundingClientRect() : { left: 0, top: 0 };
    _dragOffX = e.clientX - rect.left;
    _dragOffY = e.clientY - rect.top;

    document.addEventListener('mousemove', onSidebarDragMove);
    document.addEventListener('mouseup', onSidebarDragEnd);
  }

  function _saveSidebarOrder() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;
    const ids = Array.from(nav.querySelectorAll('.sidebar-draggable')).map(b => b.id);
    localStorage.setItem('sidebarOrder', JSON.stringify(ids));
  }

  function onSidebarDragMove(e) {
    const sbEl = document.getElementById('pixel-pet-sidebar');
    const nav = document.getElementById('sidebar-nav');
    if (!sbEl || !nav) return;

    const dx = e.clientX - (_dragOffX + sbEl.getBoundingClientRect().left + sbEl.offsetWidth / 2);
    const dy = e.clientY - _sbDragStartY;

    // If dragged horizontally outside sidebar → switch to pull-out (free float) mode
    if (!_sbDragFloating && !_sbDragReordering && Math.abs(dy) > 30 && !_isOverSidebar(e.clientX, e.clientY)) {
      _sbDragFloating = true;
      _dragging = true;
      if (_sbDragGhost) { _sbDragGhost.remove(); _sbDragGhost = null; }
      sbEl.style.opacity = '';
      sbEl.style.visibility = 'hidden';
      const freeEl = document.getElementById('pixel-pet');
      if (freeEl) { freeEl.style.display = ''; freeEl.style.cursor = 'grabbing'; }
      const rect = sbEl.getBoundingClientRect();
      petX = rect.left;
      petY = rect.top;
    }

    if (_sbDragFloating) {
      petX = e.clientX - _dragOffX;
      petY = e.clientY - _dragOffY;
      drawPetFree();
      return;
    }
  }

  function onSidebarDragEnd(e) {
    document.removeEventListener('mousemove', onSidebarDragMove);
    document.removeEventListener('mouseup', onSidebarDragEnd);

    if (_sbDragGhost) { _sbDragGhost.remove(); _sbDragGhost = null; }

    const sbEl = document.getElementById('pixel-pet-sidebar');

    if (_sbDragFloating) {
      _dragging = false;
      _sbDragFloating = false;
      // Dropped outside sidebar → switch to free mode
      if (!_isOverSidebar(e.clientX, e.clientY)) {
        if (sbEl) sbEl.style.visibility = '';
        petX = Math.max(70, Math.min(window.innerWidth - 60, petX));
        petY = Math.max(20, Math.min(window.innerHeight - 60, petY));
        petTargetX = petX;
        petTargetY = petY;
        window.setPixelPetMode('free');
        return;
      }
      // Snap back to nest → restart in sidebar mode
      const freeEl = document.getElementById('pixel-pet');
      if (freeEl) freeEl.style.display = 'none';
      if (sbEl) sbEl.style.visibility = '';
      window.setPixelPetMode('sidebar');
      return;
    }

    if (_sbDragReordering) {
      _sbDragReordering = false;
      if (sbEl) sbEl.style.opacity = '';
      _saveSidebarOrder();
      // Suppress the click that would follow
      if (sbEl) {
        const suppress = ev => { ev.stopPropagation(); ev.preventDefault(); };
        sbEl.addEventListener('click', suppress, { capture: true, once: true });
      }
      return;
    }

    // No drag happened — treat as click
    petState = _dragPrevState;
  }

  // ── Click handling ──
  let _lastClickTime = 0;
  let _dragStartX = 0, _dragStartY = 0;
  function onPetMouseDown(e) {
    if (e.button !== 0) return;
    _dragStartX = e.clientX;
    _dragStartY = e.clientY;
    if (isSidebarMode()) {
      onSidebarDragStart(e);
    } else {
      onDragStart(e);
    }
  }

  function onPetClick(e) {
    e.stopPropagation();
    e.preventDefault();
    // Only count as click if barely moved
    const dist = Math.sqrt((_dragStartX - e.clientX)**2 + (_dragStartY - e.clientY)**2);
    if (dist > 5) return;

    const now = Date.now();
    if (now - _lastClickTime < 350) {
      _lastClickTime = 0;
      if (petState !== 'happy') prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
      if (!isSidebarMode()) {
        const fleeDist = 300 + Math.random() * 200;
        const angle = Math.random() * Math.PI * 2;
        petTargetX = Math.max(70, Math.min(window.innerWidth - 60, petX + Math.cos(angle) * fleeDist));
        petTargetY = Math.max(20, Math.min(window.innerHeight - 60, petY + Math.sin(angle) * fleeDist));
        petDir = petTargetX > petX ? 1 : -1;
      }
      petState = 'run';
      petTempTimer = PET_FPS * 3;
    } else {
      _lastClickTime = now;
      setTimeout(() => {
        if (_lastClickTime === now) {
          if (petState !== 'happy') prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
          petState = 'happy';
          petTempTimer = PET_FPS * 2.5;
        }
      }, 350);
    }
  }

  function startPixelPet() {
    if (_petLoop) return;
    const mode = getPetMode();
    const freeContainer = document.getElementById('pixel-pet');
    const sbContainer = document.getElementById('pixel-pet-sidebar');

    if (mode === 'sidebar') {
      if (freeContainer) freeContainer.style.display = 'none';
      if (sbContainer) sbContainer.style.display = '';
      petState = 'idle'; petStateTimer = PET_FPS * 5;
      _petLoop = setInterval(sidebarTick, 1000 / PET_FPS);
      if (sbContainer) {
        sbContainer.onmousedown = onPetMouseDown;
        sbContainer.onclick = onPetClick;
      }
    } else {
      // Show empty bed in sidebar even when pet is free-floating
      if (sbContainer) {
        sbContainer.style.display = '';
        sbContainer.onmousedown = null;
        sbContainer.onclick = function() { window.setPixelPetMode('sidebar'); };
        const sbCanvas = document.getElementById('pet-canvas-sb');
        if (sbCanvas) {
          const sbCtx = sbCanvas.getContext('2d');
          sbCtx.clearRect(0, 0, CPX, CPX);
          drawPetBed(sbCtx);
        }
      }
      if (freeContainer) {
        freeContainer.style.display = '';
        freeContainer.style.cursor = 'grab';
      }
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { petX = Math.random() * window.innerWidth; petY = 20; }
      else if (edge === 1) { petX = Math.random() * window.innerWidth; petY = window.innerHeight - 60; }
      else if (edge === 2) { petX = 70; petY = Math.random() * window.innerHeight; }
      else { petX = window.innerWidth - 60; petY = Math.random() * window.innerHeight; }
      pickTarget();
      petStateTimer = PET_FPS * 3;
      _petLoop = setInterval(petTick, 1000 / PET_FPS);
      if (freeContainer) {
        freeContainer.onmousedown = onPetMouseDown;
        freeContainer.onclick = onPetClick;
      }
    }
  }

  function stopPixelPet() {
    if (_petLoop) { clearInterval(_petLoop); _petLoop = null; }
    const freeContainer = document.getElementById('pixel-pet');
    const sbContainer = document.getElementById('pixel-pet-sidebar');
    if (freeContainer) { freeContainer.style.display = 'none'; freeContainer.onmousedown = null; freeContainer.onclick = null; }
    if (sbContainer) { sbContainer.style.display = 'none'; sbContainer.onmousedown = null; sbContainer.onclick = null; }
  }

  window.togglePixelPet = function(on) {
    localStorage.setItem('pixelPet', on ? 'on' : 'off');
    if (on) {
      startPixelPet();
      if (!localStorage.getItem('ach_pixel_parent')) {
        localStorage.setItem('ach_pixel_parent', '1');
        petCelebrate();
        if (typeof showAchievement === 'function') showAchievement('Pixel Parent', 'Adopted your pixel pet');
      }
    } else stopPixelPet();
  };

  window.setPixelPetType = function(type) {
    localStorage.setItem('pixelPetType', type);
    if (typeof renderSettingsView === 'function') renderSettingsView();
  };

  window.setPixelPetMode = function(mode) {
    localStorage.setItem('pixelPetMode', mode);
    if (localStorage.getItem('pixelPet') === 'on') {
      stopPixelPet();
      startPixelPet();
    }
    if (typeof renderSettingsView === 'function') renderSettingsView();
  };

  window.petReact = function(reaction) {
    if (localStorage.getItem('pixelPet') !== 'on') return;
    if (reaction === 'happy') {
      if (petState !== 'happy') prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
      petState = 'happy'; petTempTimer = PET_FPS * 2;
    }
  };

  // Celebration state for achievements - longer, more excited animation
  window.petCelebrate = function() {
    if (localStorage.getItem('pixelPet') !== 'on') return;
    if (!['celebrate','happy'].includes(petState)) {
      prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
    }
    petState = 'celebrate';
    petTempTimer = PET_FPS * 4; // 4 seconds of celebration
  };

  // Track activity
  function onActivity() {
    _lastActivity = Date.now();
    if (petState === 'sleep') { petState = 'idle'; petStateTimer = PET_FPS * 3; prevBaseState = 'idle'; }
  }
  window.addEventListener('mousemove', function(e) { _mouseX = e.clientX; _mouseY = e.clientY; onActivity(); }, { passive: true });
  window.addEventListener('keydown', onActivity, { passive: true });
  window.addEventListener('scroll', function() {
    _scrollSpeed = Math.abs(window.scrollY - _lastScrollY);
    _lastScrollY = window.scrollY;
    onActivity();
  }, { passive: true });

  // Init
  if (localStorage.getItem('pixelPet') === 'on') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPixelPet);
    else setTimeout(startPixelPet, 0);
  }

  // Expose thumbnail renderer for status picker
  window._renderPetThumb = function(type, size) {
    const pet = PET_TYPES[type];
    if (!pet) return null;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const scale = size / G;
    const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x * scale, y * scale, scale, scale); };
    pet.draw(px, { blink: false, tired: false, sleeping: false, sitting: true, legFrame: 0 });
    return canvas;
  };

  window._PET_TYPE_KEYS = Object.keys(PET_TYPES);
})();
