import { useState, useRef, useCallback, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// APP META
// ═══════════════════════════════════════════════════════════════════════════════
const APP_NAME   = "BloodCheck";
const GITHUB_URL = "https://github.com/paladinv/Bloodcheck";
const SITE_URL   = "https://bloodcheck.app";

// ═══════════════════════════════════════════════════════════════════════════════
// BLOOD PROFILES  (colorblind-safe: every severity uses a unique SHAPE +
// hatch PATTERN drawn on thumbnails; colour is supplementary only)
//
// Severity vocabulary is deliberately calm:
//   "look_into"  – was "urgent"   – fresh / dark-red blood
//   "monitor"    – was "warning"  – maroon / brown (older blood)
//   "keep_watch" – was "caution"  – black / tarry (heavily digested)
// ═══════════════════════════════════════════════════════════════════════════════
const BLOOD_PROFILES = [
  { label:"Bright Red", hMin:0,   hMax:15,  sMin:45, sMax:100, lMin:25, lMax:55,
    color:"#60a5fa", severity:"look_into",  hatchStyle:"vertical"  },
  { label:"Dark Red",   hMin:340, hMax:360, sMin:40, sMax:100, lMin:15, lMax:40,
    color:"#60a5fa", severity:"look_into",  hatchStyle:"vertical"  },
  { label:"Maroon",     hMin:0,   hMax:20,  sMin:30, sMax:80,  lMin:10, lMax:25,
    color:"#fb923c", severity:"monitor",    hatchStyle:"diagonal"  },
  { label:"Brown",      hMin:15,  hMax:40,  sMin:25, sMax:70,  lMin:8,  lMax:22,
    color:"#fb923c", severity:"monitor",    hatchStyle:"diagonal"  },
  { label:"Dark/Tarry", hMin:0,   hMax:360, sMin:0,  sMax:30,  lMin:2,  lMax:10,
    color:"#c084fc", severity:"keep_watch", hatchStyle:"dots"      },
];

// Per-severity metadata: shape glyph, human-friendly label, calm explanation.
const SEVERITY_META = {
  look_into: {
    shape:"▲",
    label:"Something to look into",
    explanation:
      "The scan picked up signs that may be fresh blood. This doesn't necessarily mean something serious — it can sometimes come from minor irritation. " +
      "It's a good idea to mention it to your doctor, especially if it happens again or if you feel unwell.",
  },
  monitor: {
    shape:"◆",
    label:"Worth keeping an eye on",
    explanation:
      "The scan detected signs of older or partially digested blood. This can have a range of causes. " +
      "Try noting whether it happens again over the next few days and let your doctor know — they can run a simple test to investigate.",
  },
  keep_watch: {
    shape:"●",
    label:"Worth a mention to your doctor",
    explanation:
      "Very dark material was detected. Diet, medications, and other factors can cause dark stools, so this doesn't always indicate a problem. " +
      "If it happens more than once, or if you also notice other symptoms, it's worth bringing up with your doctor.",
  },
};

// Sample-type-specific guidance layered on top of severity
const SAMPLE_ADVICE = {
  urine: {
    look_into: "Blood in urine can come from the bladder or kidneys. In many cases there's a straightforward explanation, but a quick check-up is the easiest next step.",
    monitor:   "Darker blood in urine sometimes means it has been present for a while. Your doctor can do a simple urinalysis to find out more.",
    keep_watch:"Very dark urine can be caused by dehydration or certain foods. Drinking more water and checking again in a day or two is reasonable — but do mention it at your next appointment.",
  },
  stool: {
    look_into: "Visible blood in stool is something your doctor will want to know about. There are many possible causes, and most are very treatable once identified.",
    monitor:   "Maroon or brownish stool can indicate blood from higher up in the digestive tract. A doctor can arrange straightforward tests to investigate.",
    keep_watch:"Very dark or tarry stools are worth reporting to your doctor, particularly if they occur more than once. They may arrange a simple check.",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLOUR CORRECTION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════
const TARGET_WHITE_AMBIENT = 240;
const TARGET_WHITE_FLASH   = 250;
const SHADE_GRID            = 8;
const LIGHT_DIM_MAX         = 38;
const LIGHT_BRIGHT_MIN      = 220;

function median(arr){
  if(!arr.length) return 0;
  const s = Array.from(arr).sort((a,b)=>a-b);
  const m = s.length>>1;
  return s.length&1 ? s[m] : (s[m-1]+s[m])/2;
}

function computeWhiteBalanceGains(data, width, height, flashIsOn){
  const TARGET = flashIsOn ? TARGET_WHITE_FLASH : TARGET_WHITE_AMBIENT;
  const step=4, lums=[];
  for(let i=0;i<data.length;i+=step*4)
    lums.push(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2]);
  lums.sort((a,b)=>a-b);
  const thresh = lums[Math.floor(lums.length*0.85)];
  const rs=[],gs=[],bs=[];
  for(let i=0;i<data.length;i+=step*4){
    const r=data[i],g=data[i+1],b=data[i+2];
    if(0.299*r+0.587*g+0.114*b>=thresh && r>=140 && g>=140 && b>=140)
      { rs.push(r); gs.push(g); bs.push(b); }
  }
  if(rs.length<20) return {gainR:1,gainG:1,gainB:1};
  const cl=v=>Math.min(1.6,Math.max(0.6,v));
  return { gainR:cl(TARGET/median(rs)), gainG:cl(TARGET/median(gs)), gainB:cl(TARGET/median(bs)) };
}

function buildShadeGrid(data, width, height, gains){
  const cW=width/SHADE_GRID, cH=height/SHADE_GRID;
  const sums=new Float64Array(SHADE_GRID*SHADE_GRID);
  const counts=new Uint32Array(SHADE_GRID*SHADE_GRID);
  for(let y=0;y<height;y+=2){
    const gy=Math.min(Math.floor(y/cH),SHADE_GRID-1);
    for(let x=0;x<width;x+=2){
      const i=(y*width+x)*4;
      const r=Math.min(255,data[i]*gains.gainR);
      const g=Math.min(255,data[i+1]*gains.gainG);
      const b=Math.min(255,data[i+2]*gains.gainB);
      const gx=Math.min(Math.floor(x/cW),SHADE_GRID-1);
      const idx=gy*SHADE_GRID+gx;
      sums[idx]+=0.299*r+0.587*g+0.114*b;
      counts[idx]++;
    }
  }
  const cellAvg=new Float64Array(SHADE_GRID*SHADE_GRID);
  let gS=0,gC=0;
  for(let i=0;i<sums.length;i++){
    cellAvg[i]=counts[i]?sums[i]/counts[i]:128;
    gS+=sums[i]; gC+=counts[i];
  }
  return { cellAvg, globalAvg:gC?gS/gC:128, cellW:cW, cellH:cH };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HSL HELPERS & BLOOD MATCHING
// ═══════════════════════════════════════════════════════════════════════════════
function rgbToHsl(r,g,b){
  r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
  let h=0,s=0,l=(mx+mn)/2;
  if(mx!==mn){
    const d=mx-mn;
    s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===r) h=((g-b)/d+(g<b?6:0))/6;
    else if(mx===g) h=((b-r)/d+2)/6;
    else h=((r-g)/d+4)/6;
  }
  return {h:h*360,s:s*100,l:l*100};
}

function matchesBlood(r,g,b){
  const {h,s,l}=rgbToHsl(r,g,b);
  for(const p of BLOOD_PROFILES){
    const hOk = p.hMin<=p.hMax ? (h>=p.hMin&&h<=p.hMax) : (h>=p.hMin||h<=p.hMax);
    if(hOk && s>=p.sMin && s<=p.sMax && l>=p.lMin && l<=p.lMax) return p;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAMPLE-TYPE CLASSIFIER  (urine vs stool)
// ═══════════════════════════════════════════════════════════════════════════════
function classifySampleType(data, width, height, gains, shade){
  const cx=width*0.3, cy=height*0.3, cw=width*0.4, ch=height*0.4;
  let lumS=0, satS=0, n=0;
  for(let y=Math.floor(cy); y<cy+ch; y+=3){
    const gy=Math.min(Math.floor(y/shade.cellH),SHADE_GRID-1);
    for(let x=Math.floor(cx); x<cx+cw; x+=3){
      const i=(y*width+x)*4;
      let r=data[i]*gains.gainR, g=data[i+1]*gains.gainG, b=data[i+2]*gains.gainB;
      const gx=Math.min(Math.floor(x/shade.cellW),SHADE_GRID-1);
      const sf=Math.min(1.5,Math.max(0.7,shade.globalAvg/(shade.cellAvg[gy*SHADE_GRID+gx]||1)));
      r=Math.min(255,r*sf); g=Math.min(255,g*sf); b=Math.min(255,b*sf);
      const {s,l}=rgbToHsl(r,g,b);
      lumS+=l; satS+=s; n++;
    }
  }
  return (n && lumS/n>55 && satS/n<30) ? "urine" : "stool";
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLUSTER DETECTIONS → BOUNDING BOXES
// ═══════════════════════════════════════════════════════════════════════════════
function clusterDetections(pixels, width, height){
  const G=12, gW=Math.ceil(width/G), gH=Math.ceil(height/G);
  const grid=Array.from({length:gW*gH},()=>({count:0,profiles:{}}));
  pixels.forEach(({x,y,profile})=>{
    const c=grid[Math.floor(y/G)*gW+Math.floor(x/G)];
    c.count++; c.profiles[profile.label]=(c.profiles[profile.label]||0)+1;
  });
  const visited=new Set(), boxes=[];
  for(let gy=0;gy<gH;gy++) for(let gx=0;gx<gW;gx++){
    const idx=gy*gW+gx;
    if(visited.has(idx)||grid[idx].count<3) continue;
    const q=[idx]; visited.add(idx);
    let mnX=gx,mxX=gx,mnY=gy,mxY=gy,tot=0; const pT={};
    while(q.length){
      const ci=q.shift(), cx=ci%gW, cy=Math.floor(ci/gW);
      mnX=Math.min(mnX,cx); mxX=Math.max(mxX,cx);
      mnY=Math.min(mnY,cy); mxY=Math.max(mxY,cy);
      tot+=grid[ci].count;
      Object.entries(grid[ci].profiles).forEach(([k,v])=>{ pT[k]=(pT[k]||0)+v; });
      [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]].forEach(([nx,ny])=>{
        if(nx<0||ny<0||nx>=gW||ny>=gH) return;
        const ni=ny*gW+nx;
        if(!visited.has(ni)&&grid[ni].count>=3){ visited.add(ni); q.push(ni); }
      });
    }
    if(tot<8) continue;
    const dom=Object.entries(pT).sort((a,b)=>b[1]-a[1])[0];
    const prof=BLOOD_PROFILES.find(p=>p.label===dom[0]);
    boxes.push({
      x:mnX*G, y:mnY*G, w:(mxX-mnX+1)*G, h:(mxY-mnY+1)*G,
      label:prof.label, color:prof.color, severity:prof.severity,
      hatchStyle:prof.hatchStyle, pixels:tot
    });
  }
  return boxes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ANALYSIS ENTRY
// ═══════════════════════════════════════════════════════════════════════════════
function analyzeImageData(imageData, width, height, flashIsOn){
  const data=imageData.data;
  const gains=computeWhiteBalanceGains(data,width,height,flashIsOn);
  const shade=buildShadeGrid(data,width,height,gains);
  const sampleType=classifySampleType(data,width,height,gains,shade);

  const bloodPixels=[];
  for(let y=0;y<height;y+=2){
    const gy=Math.min(Math.floor(y/shade.cellH),SHADE_GRID-1);
    for(let x=0;x<width;x+=2){
      const i=(y*width+x)*4;
      if(data[i+3]<128) continue;
      let r=data[i]*gains.gainR, g=data[i+1]*gains.gainG, b=data[i+2]*gains.gainB;
      const gx=Math.min(Math.floor(x/shade.cellW),SHADE_GRID-1);
      const sf=Math.min(1.5,Math.max(0.7,shade.globalAvg/(shade.cellAvg[gy*SHADE_GRID+gx]||1)));
      r=Math.min(255,Math.max(0,r*sf));
      g=Math.min(255,Math.max(0,g*sf));
      b=Math.min(255,Math.max(0,b*sf));
      const prof=matchesBlood(r,g,b);
      if(prof) bloodPixels.push({x,y,profile:prof});
    }
  }
  return { detections:clusterDetections(bloodPixels,width,height), sampleType };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE-CAMERA BRIGHTNESS CHECK
// ═══════════════════════════════════════════════════════════════════════════════
function measureBrightness(videoEl, scratchCanvas){
  if(!videoEl||videoEl.readyState<videoEl.HAVE_ENOUGH_DATA) return null;
  const vw=videoEl.videoWidth, vh=videoEl.videoHeight;
  if(!vw||!vh) return null;
  const cX=vw*0.2, cY=vh*0.2, cW=vw*0.6, cH=vh*0.6;
  scratchCanvas.width=cW; scratchCanvas.height=cH;
  const ctx=scratchCanvas.getContext("2d");
  ctx.drawImage(videoEl,cX,cY,cW,cH,0,0,cW,cH);
  const d=ctx.getImageData(0,0,cW,cH).data;
  let sum=0,count=0;
  for(let i=0;i<d.length;i+=16){ sum+=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; count++; }
  const avg=sum/count;
  if(avg<LIGHT_DIM_MAX) return {status:"dim",value:avg};
  if(avg>LIGHT_BRIGHT_MIN) return {status:"bright",value:avg};
  return {status:"ok",value:avg};
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANVAS HATCH HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function drawHatch(ctx, rx, ry, rw, rh, style, color){
  ctx.save();
  ctx.strokeStyle=color+"99"; ctx.lineWidth=1.8;
  ctx.fillStyle=color+"22";   ctx.fillRect(rx,ry,rw,rh);
  if(style==="vertical"){
    for(let x=rx+4;x<rx+rw;x+=5){ ctx.beginPath(); ctx.moveTo(x,ry); ctx.lineTo(x,ry+rh); ctx.stroke(); }
  } else if(style==="diagonal"){
    for(let x=rx-rh;x<rx+rw+rh;x+=6){ ctx.beginPath(); ctx.moveTo(x,ry+rh); ctx.lineTo(x+rh,ry); ctx.stroke(); }
  } else {
    ctx.fillStyle=color+"bb";
    for(let dy=ry+5;dy<ry+rh;dy+=7) for(let dx=rx+5;dx<rx+rw;dx+=7){
      ctx.beginPath(); ctx.arc(dx,dy,1.8,0,Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════════
// QR PATTERN GENERATOR (seeded block pattern — visually distinct per URL)
// ═══════════════════════════════════════════════════════════════════════════════
function makeQRPattern(text, size){
  const n=21, cell=size/n;
  const m=Array.from({length:n},()=>Array(n).fill(0));
  [[0,0],[0,n-7],[n-7,0]].forEach(([r,c])=>{
    for(let y=0;y<7;y++) for(let x=0;x<7;x++)
      if(y===0||y===6||x===0||x===6||(y>=2&&y<=4&&x>=2&&x<=4)) m[r+y][c+x]=1;
  });
  for(let i=8;i<n-8;i++){ m[6][i]=i%2===0?1:0; m[i][6]=i%2===0?1:0; }
  let ci=0;
  for(let y=0;y<n;y++) for(let x=0;x<n;x++)
    if(!m[y][x]){ m[y][x]=(text.charCodeAt(ci%text.length)>>(x%8))&1; ci++; }
  return {matrix:m,cell};
}

function drawQROnCanvas(ctx, x, y, size, url){
  const {matrix,cell}=makeQRPattern(url,size);
  ctx.fillStyle="#fff"; ctx.fillRect(x-cell*2,y-cell*2,size+cell*4,size+cell*4);
  ctx.fillStyle="#000";
  matrix.forEach((row,ry)=>row.forEach((v,rx)=>{ if(v) ctx.fillRect(x+rx*cell,y+ry*cell,cell-0.5,cell-0.5); }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGO SVG
// ═══════════════════════════════════════════════════════════════════════════════
function Logo({ size=80 }){
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{display:"block"}}>
      <circle cx="50" cy="50" r="46" stroke="#60a5fa" strokeWidth="1.2" fill="none"
        strokeDasharray="50 240" strokeLinecap="round"
        style={{transform:"rotate(-50deg)",transformOrigin:"center"}} />
      <path d="M50 8 C28 8 14 28 14 46 C14 62 30 76 50 92 C70 76 86 62 86 46 C86 28 72 8 50 8Z"
        fill="#1e293b" stroke="#60a5fa" strokeWidth="2.2" strokeLinejoin="round"/>
      <circle cx="50" cy="46" r="15" stroke="#7dd3fc" strokeWidth="2.8" fill="none"/>
      <line x1="61" y1="57" x2="70" y2="66" stroke="#7dd3fc" strokeWidth="2.8" strokeLinecap="round"/>
      <circle cx="50" cy="46" r="4" fill="#fb923c"/>
      <circle cx="44" cy="41" r="2.2" fill="#7dd3fc" opacity="0.5"/>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function App(){
  const [phase,       setPhase]       = useState("home");
  const [imageUrl,    setImageUrl]    = useState(null);
  const [detections,  setDetections]  = useState([]);
  const [sampleType,  setSampleType]  = useState(null);
  const [lightStatus, setLightStatus] = useState(null);
  const [flashOn,     setFlashOn]     = useState(false);
  const [capturedAt,  setCapturedAt]  = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exportOpen,  setExportOpen]  = useState(false);
  const [cropUrls,    setCropUrls]    = useState({});

  const videoRef        = useRef(null);
  const canvasRef       = useRef(null);
  const overlayRef      = useRef(null);
  const scratchRef      = useRef(null);
  const streamRef       = useRef(null);
  const lightIntervalRef= useRef(null);
  const flashRef        = useRef(false);

  useEffect(()=>{ flashRef.current=flashOn; },[flashOn]);

  // ── Camera lifecycle ──
  const startCamera=useCallback(async()=>{
    try{
      const s=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:"environment",width:{ideal:1280},height:{ideal:960}}
      });
      streamRef.current=s;
      setFlashOn(false);
      setPhase("camera");
    } catch(e){ alert("Camera access denied or unavailable. Please enable camera permissions in your browser settings."); }
  },[]);

  useEffect(()=>{
    if(phase!=="camera"||!streamRef.current) return;
    const v=videoRef.current;
    if(!v) return;
    v.srcObject=streamRef.current;
    v.play().catch(e=>console.warn("[cam]",e));
  },[phase]);

  const stopCamera=useCallback(()=>{
    if(streamRef.current){ streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; }
  },[]);

  // ── Flash toggle ──
  const toggleFlash=useCallback(async()=>{
    if(!streamRef.current) return;
    const track=streamRef.current.getVideoTracks()[0];
    if(!track||!track.getCapabilities){ alert("Flash is not available on this device."); return; }
    const caps=track.getCapabilities();
    if(!caps.torch){ alert("Flash / torch is not supported on this device."); return; }
    const next=!flashOn;
    try{ await track.applyConstraints({advanced:[{torch:next}]}); setFlashOn(next); }
    catch(e){ alert("Could not toggle flash — the device may not support it."); }
  },[flashOn]);

  // ── Capture ──
  const capture=useCallback(()=>{
    const v=videoRef.current, c=canvasRef.current;
    if(!v||!c) return;
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    setImageUrl(c.toDataURL("image/jpeg",0.92));
    setCapturedAt(new Date());
    stopCamera();
    setPhase("scanning");
  },[stopCamera]);

  // ── Brightness polling ──
  useEffect(()=>{
    if(phase!=="camera"){
      clearInterval(lightIntervalRef.current); lightIntervalRef.current=null;
      setLightStatus(null); return;
    }
    if(!scratchRef.current) scratchRef.current=document.createElement("canvas");
    const tick=()=>{ const r=measureBrightness(videoRef.current,scratchRef.current); if(r) setLightStatus(r); };
    tick();
    lightIntervalRef.current=setInterval(tick,600);
    return()=>{ clearInterval(lightIntervalRef.current); lightIntervalRef.current=null; };
  },[phase]);

  // ── Analysis ──
  useEffect(()=>{
    if(phase!=="scanning"||!imageUrl) return;
    const img=new Image();
    img.onload=()=>{
      const c=canvasRef.current;
      c.width=img.width; c.height=img.height;
      const ctx=c.getContext("2d");
      ctx.drawImage(img,0,0);
      const imgData=ctx.getImageData(0,0,img.width,img.height);
      setTimeout(()=>{
        const {detections:det, sampleType:st}=analyzeImageData(imgData,img.width,img.height,flashRef.current);
        setDetections(det);
        setSampleType(st);
        setDetailsOpen(false);
        setCropUrls({});
        setPhase("results");
      },1500);
    };
    img.src=imageUrl;
  },[phase,imageUrl]);

  // ── Draw overlay ──
  useEffect(()=>{
    if(phase!=="results"||!imageUrl||!overlayRef.current) return;
    const img=new Image();
    img.onload=()=>{
      const c=overlayRef.current;
      c.width=img.width; c.height=img.height;
      const ctx=c.getContext("2d");
      ctx.drawImage(img,0,0);
      detections.forEach((box,i)=>{
        const pad=8;
        const rx=Math.max(0,box.x-pad), ry=Math.max(0,box.y-pad);
        const rw=Math.min(img.width-rx,box.w+pad*2), rh=Math.min(img.height-ry,box.h+pad*2);
        drawHatch(ctx,rx,ry,rw,rh,box.hatchStyle,box.color);
        ctx.strokeStyle=box.color; ctx.lineWidth=2.5; ctx.setLineDash([7,4]);
        ctx.strokeRect(rx,ry,rw,rh); ctx.setLineDash([]);
        const fs=Math.max(13,img.width*0.021);
        ctx.font=`bold ${fs}px sans-serif`;
        const lbl=String(i+1);
        const bw=ctx.measureText(lbl).width+12, bh=fs+8;
        const by=ry-bh-3<0 ? ry+rh+3 : ry-bh-3;
        ctx.fillStyle="#0f172aee";
        ctx.beginPath(); ctx.roundRect(rx,by,bw,bh,5); ctx.fill();
        ctx.fillStyle=box.color;
        ctx.fillText(lbl,rx+6,by+fs+1);
      });
      // Generate crops after overlay is drawn
      const newCrops={};
      detections.forEach((box,i)=>{
        const pad=24;
        const sx=Math.max(0,box.x-pad), sy=Math.max(0,box.y-pad);
        const sw=Math.min(img.width-sx,box.w+pad*2), sh=Math.min(img.height-sy,box.h+pad*2);
        const tmp=document.createElement("canvas");
        tmp.width=sw; tmp.height=sh;
        const tc=tmp.getContext("2d");
        tc.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
        const lx=box.x<pad?pad-box.x:0, ly=box.y<pad?pad-box.y:0;
        drawHatch(tc,lx,ly,box.w,box.h,box.hatchStyle,box.color);
        tc.strokeStyle=box.color; tc.lineWidth=2.2;
        tc.strokeRect(lx,ly,box.w,box.h);
        newCrops[i]=tmp.toDataURL("image/png");
      });
      setCropUrls(newCrops);
    };
    img.src=imageUrl;
  },[phase,imageUrl,detections]);

  // ── Watermarked export canvas ──
  function buildExportCanvas(cb){
    const img=new Image();
    img.onload=()=>{
      const W=img.width, barH=Math.max(72,W*0.09);
      const c=document.createElement("canvas");
      c.width=W; c.height=img.height+barH;
      const ctx=c.getContext("2d");
      if(overlayRef.current&&overlayRef.current.width===W)
        ctx.drawImage(overlayRef.current,0,0);
      else ctx.drawImage(img,0,0);
      const barY=img.height;
      ctx.fillStyle="#0f172a"; ctx.fillRect(0,barY,W,barH);
      const fs=Math.max(11,W*0.015);
      ctx.font=`700 ${fs*1.3}px sans-serif`; ctx.fillStyle="#f1f5f9";
      ctx.fillText(APP_NAME,14,barY+fs*1.1);
      ctx.font=`${fs*0.9}px sans-serif`; ctx.fillStyle="#64748b";
      ctx.fillText(capturedAt?capturedAt.toLocaleString():"",14,barY+fs*2.1);
      ctx.fillText(sampleType?`Sample: ${sampleType}`:"",14,barY+fs*2.9);
      ctx.font=`${fs*0.75}px sans-serif`; ctx.fillStyle="#475569";
      ctx.fillText("Screening aid only — not a medical diagnosis. Consult a healthcare professional.",14,barY+barH-7);
      const qrSz=barH-16;
      drawQROnCanvas(ctx, W-qrSz-10, barY+8, qrSz, GITHUB_URL);
      cb(c);
    };
    img.src=imageUrl;
  }

  function savePhoto(){
    buildExportCanvas(c=>{
      c.toBlob(blob=>{
        const url=URL.createObjectURL(blob);
        const a=document.createElement("a");
        a.href=url; a.download=`${APP_NAME}_${Date.now()}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url),3000);
      },"image/png");
    });
  }

  function exportPDF(){
    buildExportCanvas(c=>{
      c.toBlob(jpgBlob=>{
        const reader=new FileReader();
        reader.onload=()=>{
          const b64=reader.result.split(",")[1];
          const imgBytes=Uint8Array.from(atob(b64),ch=>ch.charCodeAt(0));
          const imgW=c.width, imgH=c.height;
          const maxW=560, maxH=760;
          const scale=Math.min(maxW/imgW, maxH/imgH);
          const pW=Math.round(imgW*scale), pH=Math.round(imgH*scale);
          const imgX=Math.round((595-pW)/2), imgY=Math.round(842-pH-40);
          const dateStr=capturedAt?capturedAt.toLocaleString():"";
          const detStr=detections.length
            ? detections.map(d=>`${SEVERITY_META[d.severity].shape} ${d.label}`).join(", ")
            : "No blood detected";
          const textStream =
            `BT /F1 13 Tf 40 815 Td (${APP_NAME} - Scan Results) Tj ET\n`+
            `BT /F1 9 Tf 40 798 Td (Date: ${dateStr}) Tj ET\n`+
            `BT /F1 9 Tf 40 785 Td (Sample type: ${sampleType||"unknown"}) Tj ET\n`+
            `BT /F1 9 Tf 40 772 Td (Findings: ${detStr}) Tj ET\n`+
            `q ${pW} 0 0 ${pH} ${imgX} ${imgY} cm /Im0 Do Q\n`+
            `BT /F1 7 Tf 40 22 Td (Screening aid only - not a medical diagnosis. Consult a healthcare professional.) Tj ET\n`+
            `BT /F1 7 Tf 40 12 Td (MIT License | ${GITHUB_URL}) Tj ET\n`;
          const objects=[];
          objects.push("%PDF-1.4\n");
          objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
          objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
          objects.push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]\n   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Im0 6 0 R >> >> >>\nendobj\n");
          objects.push(`4 0 obj\n<< /Length ${new TextEncoder().encode(textStream).length} >>\nstream\n${textStream}\nendstream\nendobj\n`);
          objects.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
          objects.push(`6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`);
          const headerText=objects.join("");
          const headerBytes=new TextEncoder().encode(headerText);
          const trailerText="\nendstream\nendobj\n"+
            "xref\n0 7\n"+
            "0000000000 65535 f \n"+
            "0000000009 00000 n \n"+
            "0000000058 00000 n \n"+
            "0000000115 00000 n \n"+
            "0000000266 00000 n \n"+
            "0000000400 00000 n \n"+
            "0000000480 00000 n \n"+
            "trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n";
          const trailerBytes=new TextEncoder().encode(trailerText);
          const total=new Uint8Array(headerBytes.length+imgBytes.length+trailerBytes.length);
          total.set(headerBytes,0);
          total.set(imgBytes,headerBytes.length);
          total.set(trailerBytes,headerBytes.length+imgBytes.length);
          const blob=new Blob([total],{type:"application/pdf"});
          const url=URL.createObjectURL(blob);
          const a=document.createElement("a");
          a.href=url; a.download=`${APP_NAME}_${Date.now()}.pdf`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(()=>URL.revokeObjectURL(url),3000);
        };
        reader.readAsDataURL(jpgBlob);
      },"image/jpeg",0.92);
    });
  }

  function emailResults(){
    savePhoto();
    const dateStr=capturedAt?capturedAt.toLocaleDateString():"";
    const subject=encodeURIComponent(`${APP_NAME} Scan Results - ${dateStr}`);
    const detLines=detections.length
      ? detections.map(d=>`  ${SEVERITY_META[d.severity].shape} ${d.label} - ${SEVERITY_META[d.severity].label}`).join("%0A")
      : "  No blood detected";
    const body =
      encodeURIComponent(`${APP_NAME} Scan Results\n`)+
      encodeURIComponent(`Date: ${capturedAt?capturedAt.toLocaleString():""}\n`)+
      encodeURIComponent(`Sample type: ${sampleType||"unknown"}\n\n`)+
      encodeURIComponent(`Findings:\n`)+detLines+
      encodeURIComponent(`\n\nNote: The scan image has been saved to your device. Please attach it to this email.\n\n`)+
      encodeURIComponent(`DISCLAIMER: ${APP_NAME} is a screening aid only and does not replace professional medical advice.\n\n`)+
      encodeURIComponent(`- ${APP_NAME}  |  ${GITHUB_URL}`);
    window.location.href=`mailto:?subject=${subject}&body=${body}`;
  }

  // ── Derived ──
  const reset=()=>{ setImageUrl(null); setDetections([]); setSampleType(null); setPhase("home"); setDetailsOpen(false); setExportOpen(false); setCropUrls({}); };
  useEffect(()=>{ return()=>stopCamera(); },[stopCamera]);

  const highestSeverity = detections.length
    ? (detections.some(d=>d.severity==="look_into") ? "look_into"
      : detections.some(d=>d.severity==="monitor")  ? "monitor"
      : "keep_watch")
    : null;

  const canCapture  = !lightStatus || lightStatus.status==="ok";
  const lightColor  = !lightStatus ? "#64748b" : lightStatus.status==="ok" ? "#22c55e" : "#fb923c";
  const lightBarPct = lightStatus ? Math.round((lightStatus.value/255)*100) : 50;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={S.root}>
      <canvas ref={canvasRef} style={{display:"none"}}/>

      {/* ══ HOME ══ */}
      {phase==="home" && (
        <div style={S.screen}>
          <div style={S.topRight}><button style={S.aboutBtn} onClick={()=>setPhase("about")}>ⓘ</button></div>
          <Logo size={100}/>
          <h1 style={S.homeTitle}>{APP_NAME}</h1>
          <p style={S.homeSub}>A health screening tool that uses your phone camera to check for signs of blood in urine and stool.</p>
          <div style={S.infoCard}>
            <p style={S.infoText}>
              Blood can appear anywhere from <strong style={{color:"#60a5fa"}}>bright red</strong> to <strong style={{color:"#c084fc"}}>very dark</strong>.
              This app uses colour correction and pattern analysis to spot signs that can be hard to see — especially for people with colour vision differences.
            </p>
          </div>
          <div style={S.disclaimerCard}>
            <p style={S.disclaimerText}>⚕️ This is a screening aid only. It cannot diagnose any condition. Always consult a healthcare professional if you have concerns.</p>
          </div>
          <button style={S.primaryBtn} onClick={startCamera}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:8}}>
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
            </svg>
            Start Scan
          </button>
          <p style={S.mitFooter}>MIT License · <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={S.linkStyle}>{APP_NAME} on GitHub</a></p>
        </div>
      )}

      {/* ══ CAMERA ══ */}
      {phase==="camera" && (
        <div style={S.cameraScreen}>
          <div style={S.cameraViewport}>
            <video ref={videoRef} style={S.video} playsInline autoPlay muted/>
            {/* Framing guide */}
            <svg style={S.guideOverlay} viewBox="0 0 100 100" preserveAspectRatio="none">
              <ellipse cx="50" cy="54" rx="37" ry="30" stroke="#ffffffaa" strokeWidth="0.55" fill="none" strokeDasharray="3.5 2.5"/>
              <text x="50" y="16" textAnchor="middle" fill="#ffffffcc" fontSize="4.2" fontFamily="system-ui,sans-serif" fontWeight="600">Centre the toilet bowl inside the oval</text>
              <text x="50" y="20.5" textAnchor="middle" fill="#ffffff77" fontSize="3" fontFamily="system-ui,sans-serif">Hold about 30–40 cm away to reduce your shadow</text>
            </svg>
            {/* Flash button */}
            <button style={{...S.camCornerBtn, left:8}} onClick={toggleFlash} aria-label="Toggle flash">
              <span style={{fontSize:14}}>{flashOn?"⚡":"💡"}</span>
              <span style={{fontSize:9, color: flashOn?"#fbbf24":"#94a3b8"}}>{flashOn?"ON":"OFF"}</span>
            </button>
            {/* Compact light pill */}
            <div style={{...S.lightPill, borderColor:lightColor}}>
              <span style={{fontSize:11}}>{!lightStatus?"…":lightStatus.status==="dim"?"🌑":lightStatus.status==="bright"?"💡":"☀️"}</span>
              <div style={S.lightTrack}>
                <div style={{...S.lightFill, width:`${lightBarPct}%`, background:lightColor}}/>
              </div>
            </div>
          </div>
          <div style={S.cameraControls}>
            <button style={S.cancelBtn} onClick={()=>{stopCamera();setFlashOn(false);setPhase("home");}}>Cancel</button>
            <button style={{...S.captureBtn,...(!canCapture?S.captureBtnDisabled:{})}} onClick={canCapture?capture:undefined} disabled={!canCapture} aria-label="Capture">
              <div style={{...S.captureInner,...(!canCapture?{background:"#475569"}:{})}}/>
            </button>
            <div style={{width:56}}/>
          </div>
          {!canCapture && (
            <p style={S.lightWarning}>
              {lightStatus?.status==="dim"
                ? "Too dim — move closer to a light or tap the flash button above."
                : "Too bright — step back or turn off direct overhead light."}
            </p>
          )}
        </div>
      )}

      {/* ══ SCANNING ══ */}
      {phase==="scanning" && (
        <div style={S.screen}>
          <div style={S.scanPreview}>
            <img src={imageUrl} alt="scan preview" style={S.previewImg}/>
            <div style={S.scanOverlay}><div style={S.scanLine}/></div>
          </div>
          <div style={S.scanStatus}>
            <div style={S.pulser}/>
            <span style={S.scanText}>Analysing your scan…</span>
          </div>
        </div>
      )}

      {/* ══ RESULTS ══ */}
      {phase==="results" && (
        <div style={S.screen}>
          <div style={S.resultsHeader}>
            <button style={S.backBtn} onClick={reset}>← Back</button>
            <Logo size={30}/>
            <span style={S.resultsTitle}>Your Results</span>
          </div>
          <div style={S.disclaimerCard}>
            <p style={S.disclaimerText}>⚕️ These results are for information only. They are not a diagnosis. If you have any concerns, please speak with a healthcare professional.</p>
          </div>
          <div style={S.resultImageWrap}>
            <canvas ref={overlayRef} style={S.resultCanvas}/>
          </div>
          <div style={S.sampleBadge}>
            <span style={S.sampleLabel}>{sampleType==="urine"?"🧪 Urine sample detected":"🧫 Stool sample detected"}</span>
            <span style={S.sampleSub}>Scanned {capturedAt?capturedAt.toLocaleString():""}</span>
          </div>

          {detections.length===0 && (
            <div style={S.cleanCard}>
              <div style={S.cleanIcon}>✓</div>
              <p style={S.cleanTitle}>No signs of blood detected</p>
              <p style={S.cleanSub}>Your scan looks clear. Regular monitoring is a simple way to stay on top of your health.</p>
            </div>
          )}

          {detections.length>0 && (
            <>
              <div style={S.summaryCard}>
                <p style={S.summaryTitle}>{SEVERITY_META[highestSeverity].label}</p>
                <p style={S.summaryBody}>
                  The scan found {detections.length} area{detections.length>1?"s":""} that are worth looking at.
                  The details below explain what was detected and what it might mean.
                </p>
              </div>

              {/* Collapsible details */}
              <div style={S.collapsibleWrap}>
                <button style={S.collapsibleHead} onClick={()=>setDetailsOpen(!detailsOpen)}>
                  <span style={S.collapsibleLabel}>
                    {detailsOpen?"▾ Hide details":"▸ Show details"}
                    <span style={S.collapsibleCount}>{detections.length} finding{detections.length>1?"s":""}</span>
                  </span>
                </button>
                {detailsOpen && detections.map((d,i)=>{
                  const meta=SEVERITY_META[d.severity];
                  const advice=(SAMPLE_ADVICE[sampleType]||{})[d.severity]||meta.explanation;
                  return (
                    <div key={i} style={S.detCard}>
                      <div style={S.detHead}>
                        <span style={{...S.detShape, color:d.color}}>{meta.shape}</span>
                        <div>
                          <div style={S.detTitle}>Finding #{i+1} — {d.label}</div>
                          <div style={S.detSub}>{meta.label} · {d.pixels} pixels analysed</div>
                        </div>
                      </div>
                      {cropUrls[i] && <img src={cropUrls[i]} alt={`Detection ${i+1} crop`} style={S.cropThumb}/>}
                      <p style={S.detBody}>{advice}</p>
                    </div>
                  );
                })}
              </div>

              <div style={S.guidanceCard}>
                <p style={S.guidanceTitle}>What you can do</p>
                <p style={S.guidanceBody}>
                  {(SAMPLE_ADVICE[sampleType]||{})[highestSeverity] || SEVERITY_META[highestSeverity].explanation}
                </p>
              </div>
            </>
          )}

          {/* Action buttons */}
          <div style={S.actionRow}>
            <button style={S.actionBtn} onClick={savePhoto}>💾 Save</button>
            <div style={S.exportWrap}>
              <button style={S.actionBtn} onClick={()=>setExportOpen(!exportOpen)}>📤 Export</button>
              {exportOpen && (
                <div style={S.exportMenu}>
                  <button style={S.exportOpt} onClick={()=>{savePhoto();setExportOpen(false);}}>As Image</button>
                  <button style={S.exportOpt} onClick={()=>{exportPDF();setExportOpen(false);}}>As PDF</button>
                </div>
              )}
            </div>
            <button style={S.actionBtn} onClick={emailResults}>✉️ Email</button>
          </div>

          <button style={S.primaryBtn} onClick={reset}>New Scan</button>
          <p style={S.mitFooter}>MIT License · <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={S.linkStyle}>{APP_NAME} on GitHub</a></p>
        </div>
      )}

      {/* ══ ABOUT ══ */}
      {phase==="about" && (
        <div style={S.screen}>
          <div style={S.resultsHeader}>
            <button style={S.backBtn} onClick={()=>setPhase("home")}>← Back</button>
            <span style={S.resultsTitle}>About</span>
          </div>
          <Logo size={76}/>
          <h2 style={S.aboutTitle}>{APP_NAME}</h2>
          <p style={S.aboutVersion}>v1.1.0 · Open Source · MIT License</p>
          <div style={S.aboutCard}>
            <p style={S.aboutHeading}>What this app does</p>
            <p style={S.aboutBody}>
              {APP_NAME} uses your phone camera to scan for signs of blood in urine and stool.
              It applies automatic colour correction and pattern analysis to detect blood across the full spectrum —
              from bright red to very dark — even under challenging bathroom lighting conditions.
            </p>
          </div>
          <div style={S.aboutCard}>
            <p style={S.aboutHeading}>Why it was built</p>
            <p style={S.aboutBody}>
              This app was inspired by research into the impact of colour vision deficiency on bladder and colorectal cancer survival.
              Studies show that people with colour blindness are significantly less likely to notice early warning signs in their urine or stool,
              leading to later diagnoses and worse health outcomes. {APP_NAME} is designed to be fully accessible —
              using distinct shapes, hatch patterns, and labels so that no information depends on colour perception alone.
            </p>
            <a href="https://www.nature.com/articles/s44360-025-00032-7" target="_blank" rel="noopener noreferrer" style={{...S.linkStyle, display:"block", marginTop:8, fontSize:12}}>
              📄 Research: Impact of colour vision deficiency on bladder and colorectal cancer survival
            </a>
          </div>
          <div style={S.aboutCard}>
            <p style={S.aboutHeading}>Colorblind accessibility</p>
            <p style={S.aboutBody}>
              Every detection indicator uses a unique combination of shape (▲ ◆ ●), hatch pattern (vertical lines, diagonal lines, or dots),
              and a text label. The colour palette (blue, orange, purple) is chosen to remain distinguishable under protanopia, deuteranopia,
              and tritanopia. No information is conveyed by colour alone.
            </p>
          </div>
          <div style={S.aboutCard}>
            <p style={S.aboutHeading}>Open source & license</p>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{...S.linkStyle, display:"block", fontSize:12}}>🔗 GitHub — {GITHUB_URL}</a>
            <p style={{...S.aboutBody, marginTop:10, fontSize:11.5, color:"#64748b", borderTop:"1px solid #334155", paddingTop:10}}>
              MIT License. Copyright (c) 2025. Permission is hereby granted, free of charge, to any person obtaining a copy
              of this software and associated documentation files (the "Software"), to deal in the Software without restriction,
              including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
              copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the above
              copyright notice and this permission notice being included in all copies or substantial portions of the Software.
            </p>
          </div>
          <div style={S.disclaimerCard}>
            <p style={S.disclaimerText}>⚕️ {APP_NAME} is a screening aid only. It does not diagnose any medical condition. Always consult a qualified healthcare professional.</p>
          </div>
          <p style={S.mitFooter}>MIT License · <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={S.linkStyle}>{APP_NAME} on GitHub</a></p>
        </div>
      )}

      <style>{`
        @keyframes scanSlide { 0%{top:0%} 100%{top:100%} }
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════
const S = {
  root:{
    minHeight:"100vh", background:"#0f172a", color:"#f1f5f9",
    fontFamily:"'SF Pro Display','Segoe UI',system-ui,sans-serif",
    display:"flex", flexDirection:"column", alignItems:"center",
  },
  screen:{
    width:"100%", maxWidth:480, minHeight:"100vh",
    display:"flex", flexDirection:"column", alignItems:"center",
    padding:"28px 18px 28px", gap:14, boxSizing:"border-box",
  },
  topRight:{ width:"100%", display:"flex", justifyContent:"flex-end", marginBottom:-4 },
  aboutBtn:{ background:"none", border:"none", color:"#64748b", fontSize:22, cursor:"pointer", padding:"2px 6px", lineHeight:1 },
  homeTitle:{ fontSize:30, fontWeight:700, letterSpacing:-0.5, color:"#f8fafc", margin:"2px 0 0" },
  homeSub:{ fontSize:13.5, color:"#64748b", textAlign:"center", margin:0, maxWidth:300, lineHeight:1.55 },
  infoCard:{ background:"#1e293b", borderRadius:12, padding:"14px 16px", border:"1px solid #334155", width:"100%", boxSizing:"border-box" },
  infoText:{ margin:0, fontSize:13, color:"#94a3b8", lineHeight:1.6 },
  disclaimerCard:{ background:"#1a1a2e", border:"1px solid #475569", borderRadius:10, padding:"10px 14px", width:"100%", boxSizing:"border-box" },
  disclaimerText:{ margin:0, fontSize:11.5, color:"#78716c", lineHeight:1.5 },
  primaryBtn:{
    display:"flex", alignItems:"center", justifyContent:"center",
    background:"linear-gradient(135deg,#2563eb,#1d4ed8)", color:"#fff",
    border:"none", borderRadius:14, padding:"14px 28px", fontSize:16,
    fontWeight:600, cursor:"pointer", width:"100%", maxWidth:320,
    boxShadow:"0 4px 20px #2563eb44",
  },
  cancelBtn:{ background:"transparent", color:"#64748b", border:"1px solid #334155", borderRadius:10, padding:"8px 18px", fontSize:14, cursor:"pointer" },
  linkStyle:{ color:"#60a5fa", textDecoration:"none" },
  mitFooter:{ margin:"6px 0 0", fontSize:10.5, color:"#475569", textAlign:"center" },
  // Camera
  cameraScreen:{
    width:"100%", maxWidth:480, minHeight:"100vh",
    display:"flex", flexDirection:"column", alignItems:"center",
    padding:"8px 0 16px", gap:10, boxSizing:"border-box",
  },
  cameraViewport:{ width:"100%", flex:1, position:"relative", background:"#000", overflow:"hidden", minHeight:340, maxHeight:"70vh" },
  video:{ width:"100%", height:"100%", objectFit:"cover", display:"block" },
  guideOverlay:{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" },
  camCornerBtn:{
    position:"absolute", top:8, zIndex:2,
    background:"#00000088", border:"1px solid #ffffff33", borderRadius:18,
    padding:"4px 9px", cursor:"pointer",
    display:"flex", flexDirection:"column", alignItems:"center", gap:1,
  },
  lightPill:{
    position:"absolute", top:8, right:8, zIndex:2,
    background:"#00000088", border:"1px solid", borderRadius:16,
    padding:"3px 7px", display:"flex", alignItems:"center", gap:5, pointerEvents:"none",
  },
  lightTrack:{ width:32, height:4, background:"#334155", borderRadius:2, overflow:"hidden" },
  lightFill:{ height:"100%", borderRadius:2, transition:"width 0.4s, background 0.4s" },
  cameraControls:{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", maxWidth:320, padding:"0 18px" },
  captureBtn:{
    width:68, height:68, borderRadius:"50%", border:"3px solid #fff",
    background:"transparent", cursor:"pointer",
    display:"flex", alignItems:"center", justifyContent:"center",
    boxShadow:"0 0 0 2.5px #2563eb",
  },
  captureInner:{ width:52, height:52, borderRadius:"50%", background:"#2563eb" },
  captureBtnDisabled:{ opacity:0.4, cursor:"not-allowed", boxShadow:"0 0 0 2.5px #475569" },
  lightWarning:{
    margin:0, fontSize:12, color:"#fbbf24", textAlign:"center",
    maxWidth:300, lineHeight:1.4, fontWeight:500,
    background:"#451a0333", border:"1px solid #78350f55", borderRadius:8, padding:"7px 14px",
  },
  // Scanning
  scanPreview:{ width:"100%", position:"relative", borderRadius:14, overflow:"hidden", border:"1px solid #334155" },
  previewImg:{ width:"100%", display:"block" },
  scanOverlay:{ position:"absolute", inset:0, pointerEvents:"none" },
  scanLine:{
    position:"absolute", left:0, right:0, height:3,
    background:"linear-gradient(90deg,transparent,#2563eb,transparent)",
    boxShadow:"0 0 12px #2563eb88", animation:"scanSlide 1.2s linear infinite",
  },
  scanStatus:{ display:"flex", alignItems:"center", gap:10 },
  pulser:{ width:12, height:12, borderRadius:"50%", background:"#2563eb", animation:"pulse 1s ease-in-out infinite" },
  scanText:{ fontSize:14, color:"#60a5fa", fontWeight:500 },
  // Results
  resultsHeader:{ display:"flex", alignItems:"center", width:"100%", gap:12 },
  backBtn:{ background:"none", border:"none", color:"#64748b", fontSize:14, cursor:"pointer", padding:0 },
  resultsTitle:{ fontSize:16, fontWeight:600, color:"#94a3b8" },
  resultImageWrap:{ width:"100%", borderRadius:12, overflow:"hidden", border:"1px solid #334155" },
  resultCanvas:{ width:"100%", display:"block" },
  sampleBadge:{ background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:"10px 14px", width:"100%", boxSizing:"border-box" },
  sampleLabel:{ display:"block", fontSize:14, fontWeight:600, color:"#e2e8f0" },
  sampleSub:{ display:"block", fontSize:11, color:"#64748b", marginTop:2 },
  cleanCard:{ background:"#1e293b", border:"1px solid #166534", borderRadius:14, padding:"24px 20px", textAlign:"center", width:"100%", boxSizing:"border-box" },
  cleanIcon:{ fontSize:32, color:"#22c55e", marginBottom:6 },
  cleanTitle:{ margin:0, fontSize:17, fontWeight:600, color:"#f1f5f9" },
  cleanSub:{ margin:"5px 0 0", fontSize:12.5, color:"#64748b", lineHeight:1.5 },
  summaryCard:{ background:"#1e293b", border:"1px solid #60a5fa55", borderRadius:12, padding:"14px 16px", width:"100%", boxSizing:"border-box" },
  summaryTitle:{ margin:0, fontSize:15, fontWeight:600, color:"#60a5fa" },
  summaryBody:{ margin:"5px 0 0", fontSize:12.5, color:"#94a3b8", lineHeight:1.55 },
  collapsibleWrap:{ width:"100%", borderRadius:12, overflow:"hidden", border:"1px solid #334155" },
  collapsibleHead:{ width:"100%", background:"#1e293b", border:"none", padding:"12px 16px", cursor:"pointer", textAlign:"left" },
  collapsibleLabel:{ fontSize:13.5, fontWeight:600, color:"#cbd5e1", display:"flex", justifyContent:"space-between", alignItems:"center", width:"100%" },
  collapsibleCount:{ fontSize:11, color:"#64748b", fontWeight:400 },
  detCard:{ background:"#0f172a", borderTop:"1px solid #334155", padding:"14px 16px", width:"100%", boxSizing:"border-box" },
  detHead:{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:8 },
  detShape:{ fontSize:20, fontWeight:700, lineHeight:1, flexShrink:0, marginTop:1 },
  detTitle:{ fontSize:13, fontWeight:600, color:"#e2e8f0" },
  detSub:{ fontSize:10.5, color:"#64748b", marginTop:1 },
  cropThumb:{ width:"100%", maxHeight:140, objectFit:"cover", borderRadius:8, border:"1px solid #334155", marginBottom:8 },
  detBody:{ margin:0, fontSize:12, color:"#94a3b8", lineHeight:1.55 },
  guidanceCard:{ background:"#1e293b", border:"1px solid #475569", borderRadius:12, padding:"14px 16px", width:"100%", boxSizing:"border-box" },
  guidanceTitle:{ margin:0, fontSize:13, fontWeight:600, color:"#cbd5e1" },
  guidanceBody:{ margin:"5px 0 0", fontSize:12, color:"#94a3b8", lineHeight:1.55 },
  actionRow:{ display:"flex", gap:8, width:"100%", justifyContent:"center", flexWrap:"wrap" },
  actionBtn:{ background:"#1e293b", border:"1px solid #334155", color:"#cbd5e1", borderRadius:10, padding:"9px 14px", fontSize:13, fontWeight:600, cursor:"pointer" },
  exportWrap:{ position:"relative" },
  exportMenu:{
    position:"absolute", top:"calc(100% + 5px)", left:"50%", transform:"translateX(-50%)",
    background:"#1e293b", border:"1px solid #334155", borderRadius:8,
    boxShadow:"0 6px 20px #00000066", zIndex:10, minWidth:130,
  },
  exportOpt:{ display:"block", width:"100%", background:"none", border:"none", borderBottom:"1px solid #334155", color:"#cbd5e1", padding:"10px 18px", fontSize:13, cursor:"pointer", textAlign:"left" },
  // About
  aboutTitle:{ fontSize:22, fontWeight:700, color:"#f8fafc", margin:"4px 0 2px" },
  aboutVersion:{ fontSize:12, color:"#64748b", margin:0 },
  aboutCard:{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:"16px 18px", width:"100%", boxSizing:"border-box" },
  aboutHeading:{ margin:"0 0 6px", fontSize:13.5, fontWeight:600, color:"#60a5fa" },
  aboutBody:{ margin:0, fontSize:12.5, color:"#94a3b8", lineHeight:1.6 },
};
