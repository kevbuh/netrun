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
        if(o.sleeping){
          for(let x=4;x<=11;x++)px(x,8,O);for(let x=5;x<=10;x++)px(x,8,B);
          for(let x=4;x<=11;x++)px(x,9,O);
          // tail up
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
    bird: {
      outline: '#1a1a2e', body: '#e84393', dark: '#c44dbb', inner: '#fdcb6e', eye: '#fff', pupil: '#1a1a2e',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, W = this.eye, E = this.pupil;
        // Tail feathers (behind body)
        if(!o.sleeping && !o.sitting) {
          px(3,9,D);px(2,8,D);px(2,9,O);
          px(3,10,D);px(2,10,O);
        }
        // Round head
        for(let x=6;x<=10;x++)px(x,3,O);
        px(5,4,O);px(11,4,O);px(5,5,O);px(11,5,O);px(5,6,O);px(11,6,O);
        for(let x=6;x<=10;x++)px(x,7,O);
        for(let y=4;y<=6;y++)for(let x=6;x<=10;x++)px(x,y,B);
        // Tuft on top
        px(7,2,O);px(8,1,D);px(8,2,D);px(9,2,O);
        // Eyes — big round white with pupil
        px(7,4,W);px(7,5,W);px(9,4,W);px(9,5,W);
        if(o.blink){px(7,5,B);px(9,5,B)}
        else{px(7,5,E);px(9,5,E)}
        // Beak
        px(11,5,I);px(12,5,I);px(12,6,I);
        // Cheek blush
        px(6,6,'#ff9ff3');px(10,6,'#ff9ff3');
        if(o.sleeping){
          // Tucked body
          for(let x=5;x<=11;x++)px(x,8,O);
          for(let x=6;x<=10;x++)px(x,8,B);
          for(let x=5;x<=11;x++)px(x,9,O);
          // Tail tucked
          px(5,8,D);px(4,8,D);px(4,9,O);
          return;
        }
        if(o.sitting){
          // Perched body
          px(6,8,O);px(10,8,O);for(let x=7;x<=9;x++)px(x,8,B);
          for(let x=6;x<=10;x++)px(x,9,O);
          // Feet
          px(7,10,O);px(8,10,O);px(9,10,O);
          // Wing folded
          px(5,7,D);px(4,7,D);px(4,8,D);
          return;
        }
        // Standing body — rounder
        px(6,8,O);px(10,8,O);for(let x=7;x<=9;x++)px(x,8,B);
        px(5,9,O);px(11,9,O);for(let x=6;x<=10;x++)px(x,9,B);
        px(5,10,O);px(11,10,O);for(let x=6;x<=10;x++)px(x,10,B);
        for(let x=6;x<=10;x++)px(x,11,O);
        // Wing flap
        if(o.legFrame===1){px(4,7,D);px(3,6,D);px(4,6,D);px(3,5,D)}
        else{px(4,8,D);px(3,8,D);px(4,7,D);px(3,9,D)}
        // Stick legs + feet
        px(7,12,O);px(9,12,O);
        if(o.legFrame===1){px(6,13,O);px(7,13,O);px(9,13,O);px(10,13,O)}
        else{px(7,13,O);px(8,13,O);px(9,13,O);px(10,13,O)}
      }
    },
    frog: {
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
          // Left eye top-left at (4,5), right eye top-left at (9,5)
          const eyes = [[4,5],[9,5]];
          eyes.forEach(([ex,ey])=>{
            // White 2x2
            px(ex,ey,W);px(ex+1,ey,W);px(ex,ey+1,W);px(ex+1,ey+1,W);
            // Black pupils
            if(ed==='up'){px(ex,ey,'#000');px(ex+1,ey,'#000');}          // top row
            else if(ed==='down'){px(ex,ey+1,'#000');px(ex+1,ey+1,'#000');}// bottom row
            else if(ed==='left'){px(ex,ey,'#000');px(ex,ey+1,'#000');}    // left column
            else if(ed==='right'){px(ex+1,ey,'#000');px(ex+1,ey+1,'#000');}// right column
            else{px(ex,ey,'#000');px(ex+1,ey,'#000');}                    // center = top row
          });
        }
        // ── Smiley mouth ──
        px(4,8,O);px(5,9,O);px(6,9,O);px(7,9,O);px(8,9,O);px(9,9,O);px(10,9,O);px(11,8,O);
        if(o.sleeping){
          // Extra squished loaf
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
  };

  function getPetType() { return localStorage.getItem('pixelPetType') || 'cat'; }

  // ── Particles ──
  function drawParticle(ctx, type, x, y, frame) {
    const s = S;
    if (type === 'heart') {
      ctx.fillStyle = '#e53935';
      const py = y - (frame % 8) * 0.5;
      ctx.globalAlpha = 1 - (frame % 8) / 8;
      ctx.fillRect(x*s,py*s,s,s); ctx.fillRect((x+2)*s,py*s,s,s);
      ctx.fillRect((x-1)*s,(py+1)*s,s*4,s); ctx.fillRect(x*s,(py+2)*s,s*2,s);
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

  function pickTarget() {
    const w = window.innerWidth, h = window.innerHeight;
    const margin = 20;
    // Bias toward edges: pick a random edge (top/bottom/left/right), then a position along it
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { // top
      petTargetX = margin + Math.random() * (w - margin * 2);
      petTargetY = margin + Math.random() * (h * 0.15);
    } else if (edge === 1) { // bottom
      petTargetX = margin + Math.random() * (w - margin * 2);
      petTargetY = h - margin - Math.random() * (h * 0.15);
    } else if (edge === 2) { // left
      petTargetX = margin + Math.random() * (w * 0.15);
      petTargetY = margin + Math.random() * (h - margin * 2);
    } else { // right
      petTargetX = w - margin - Math.random() * (w * 0.15);
      petTargetY = margin + Math.random() * (h - margin * 2);
    }
    // Occasionally wander inward (~20% of the time)
    if (Math.random() < 0.2) {
      petTargetX = margin + Math.random() * (w - margin * 2);
      petTargetY = margin + Math.random() * (h - margin * 2);
    }
  }

  function petTick() {
    petFrame++;
    // Eye direction follows mouse (with occasional random glance)
    if (--petEyeTimer <= 0) {
      // Mostly follow mouse, sometimes glance randomly
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
    if (['happy','run','read'].includes(petState)) {
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

    // Mouse proximity flee
    if (_fleeTimer > 0) _fleeTimer--;
    if (_mouseX >= 0 && petState !== 'sleep') {
      const mdx = petX - _mouseX, mdy = petY - _mouseY;
      const mouseDist = Math.sqrt(mdx*mdx + mdy*mdy);
      if (mouseDist < 60) {
        const norm = mouseDist < 1 ? 1 : mouseDist;
        if (mouseDist < 30) {
          // Right on top — panic scoot
          const fleeDist = 150 + Math.random() * 80;
          petTargetX = petX + (mdx / norm) * fleeDist;
          petTargetY = petY + (mdy / norm) * fleeDist;
          _fleeTimer = 0;
        } else if (_fleeTimer <= 0) {
          // Close — nudge away
          const fleeDist = 80 + Math.random() * 40;
          petTargetX = petX + (mdx / norm) * fleeDist;
          petTargetY = petY + (mdy / norm) * fleeDist;
          _fleeTimer = PET_FPS;
        }
        petTargetX = Math.max(70, Math.min(window.innerWidth - 60, petTargetX));
        petTargetY = Math.max(20, Math.min(window.innerHeight - 60, petTargetY));
        if (petState !== 'run' && petState !== 'happy') {
          prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
        }
        petState = 'run';
        petTempTimer = PET_FPS * 1.5;
      }
    }

    // Base state cycling — lazy: long idles/sits, short walks
    if (['idle','walk','sit'].includes(petState)) {
      petStateTimer--;
      if (petStateTimer <= 0) {
        if (petState === 'idle') {
          // 40% chance to just sit instead of walk
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

    // Draw
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
    const jump = petState === 'happy' && (petFrame % 6 < 3);
    const yOff = jump ? -2 : (sleeping ? 2 : (sitting ? 1 : 0));

    ctx.save();
    if (petDir === -1) { ctx.translate(CPX, 0); ctx.scale(-1, 1); }

    const pet = PET_TYPES[getPetType()] || PET_TYPES.cat;
    const pxFn = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * S, (y + yOff) * S, S, S);
    };
    pet.draw(pxFn, { blink, legFrame, sitting, sleeping, jump, eyeDir: petEyeDir });

    ctx.restore();

    if (petState === 'happy') drawParticle(ctx, 'heart', 1, 2, petFrame);
    if (petState === 'sleep') drawParticle(ctx, 'zzz', 12, 2, petFrame);
  }

  function getPetMode() { return localStorage.getItem('pixelPetMode') || 'free'; }

  function isSidebarMode() { return getPetMode() === 'sidebar'; }

  // ── Sidebar mode drawing ──
  function sidebarTick() {
    petFrame++;
    // Eye direction follows mouse in sidebar too (never up)
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

    if (['happy','run'].includes(petState)) {
      petTempTimer--;
      if (petTempTimer <= 0) petState = prevBaseState;
    }
    if (petState !== 'happy' && idleMs > 120000 && petState !== 'sleep') {
      prevBaseState = petState; petState = 'sleep';
    }
    // Simple idle/blink cycle in sidebar
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

    const blink = petState === 'sleep' || (petState === 'idle' && petFrame % 48 < 3);
    const sitting = petState === 'sit' || petState === 'read';
    const sleeping = petState === 'sleep';
    const jump = petState === 'happy' && (petFrame % 6 < 3);
    const yOff = jump ? -2 : (sleeping ? 2 : (sitting ? 1 : 0));

    const pet = PET_TYPES[getPetType()] || PET_TYPES.cat;
    const pxFn = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * S, (y + yOff) * S, S, S);
    };
    pet.draw(pxFn, { blink, legFrame: 0, sitting, sleeping, jump, eyeDir: petEyeDir });

    if (petState === 'happy') drawParticle(ctx, 'heart', 1, 2, petFrame);
    if (petState === 'sleep') drawParticle(ctx, 'zzz', 12, 2, petFrame);
  }

  // ── Click handling ──
  let _lastClickTime = 0;
  function onPetClick(e) {
    e.stopPropagation();
    e.preventDefault();
    const now = Date.now();
    if (now - _lastClickTime < 350) {
      // Double click — run far away
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
      // Single click — happy
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
      if (sbContainer) sbContainer.onclick = onPetClick;
    } else {
      if (sbContainer) sbContainer.style.display = 'none';
      if (freeContainer) freeContainer.style.display = '';
      // Spawn at a random edge
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { petX = Math.random() * window.innerWidth; petY = 20; }
      else if (edge === 1) { petX = Math.random() * window.innerWidth; petY = window.innerHeight - 60; }
      else if (edge === 2) { petX = 70; petY = Math.random() * window.innerHeight; }
      else { petX = window.innerWidth - 60; petY = Math.random() * window.innerHeight; }
      pickTarget();
      petStateTimer = PET_FPS * 3;
      _petLoop = setInterval(petTick, 1000 / PET_FPS);
      if (freeContainer) freeContainer.onclick = onPetClick;
    }
  }

  function stopPixelPet() {
    if (_petLoop) { clearInterval(_petLoop); _petLoop = null; }
    const freeContainer = document.getElementById('pixel-pet');
    const sbContainer = document.getElementById('pixel-pet-sidebar');
    if (freeContainer) { freeContainer.style.display = 'none'; freeContainer.onclick = null; }
    if (sbContainer) { sbContainer.style.display = 'none'; sbContainer.onclick = null; }
  }

  window.togglePixelPet = function(on) {
    localStorage.setItem('pixelPet', on ? 'on' : 'off');
    if (on) startPixelPet(); else stopPixelPet();
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
})();

