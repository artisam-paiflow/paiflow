// Builds the Paiflow showcase deck using the copied webinar layout.
// Run from repo root: node docs/showcase/webinar-design/build.cjs
// Backgrounds: python docs/showcase/webinar-design/make-backgrounds.py
// Fonts: Inter + JetBrains Mono. Both ship with Google Slides; install them locally to preview.
const path = require('path')
const pptxgen = require(process.env.PAIFLOW_PPTXGENJS || 'pptxgenjs')
const NOTES = require('./notes') // five-minute showcase talk track

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.33 x 7.5 in
pres.title = 'Paiflow — InstaAwards Builder Showcase'

const C = {
  ink: '0E0E0E',
  window: '131313',
  text: 'E5E2E1',
  muted: 'BCB8BB',
  accent: 'FFB1C4',
  blue: '98CBFF',
  hot: 'FF4A8D',
  white: 'FFFFFF',
  rule: '5C3F46', // solid stand-in for the hairline where transparency isn't supported (tables)
  red: 'FF5F57',
  yellow: 'FEBC2E',
  green: '28C840',
}
const SANS = 'Inter'
const MONO = 'JetBrains Mono'
const W = 13.333
const M = 0.7 // slide margin
const CW = W - 2 * M // content width
const TOP = 1.95 // first content row under a title
const TOTAL = 5
const bg = (name) => path.join(__dirname, 'assets', `${name}.jpg`)

// ---------- helpers ----------

function T(slide, text, o) {
  slide.addText(text, {
    isTextBox: true,
    fontFace: SANS,
    fontSize: 16,
    color: C.text,
    margin: 0,
    valign: 'top',
    ...o,
  })
}

const hairline = (transparency = 86, color = C.white) => ({ color, width: 0.75, transparency })

let slideNo = 0
function newSlide({ title, eyebrow, background = 'bg-tr', footer = true }) {
  const s = pres.addSlide()
  slideNo += 1
  s.background = { path: bg(background) }
  if (eyebrow) {
    T(s, eyebrow, { x: M, y: 0.55, w: 9, h: 0.3, fontFace: MONO, fontSize: 11, bold: true, color: C.accent, charSpacing: 1.5, valign: 'middle' })
  }
  if (title) {
    T(s, title, { x: M, y: 0.88, w: 10.6, h: 0.85, fontSize: 40, bold: true, charSpacing: -0.5, valign: 'middle' })
  }
  if (footer) {
    T(s, 'Paiflow · InstaAwards Builder Showcase', { x: M, y: 7.0, w: 5, h: 0.25, fontFace: MONO, fontSize: 9, color: C.muted, valign: 'middle' })
    T(s, `${String(slideNo).padStart(2, '0')} / ${TOTAL}`, { x: W - M - 2, y: 7.0, w: 2, h: 0.25, fontFace: MONO, fontSize: 9, color: C.muted, align: 'right', valign: 'middle' })
  }
  s.addNotes(NOTES[slideNo - 1])
  return s
}

// Frosted-glass panel: translucent white fill, hairline border.
function card(slide, x, y, w, h, { fillT = 94, radius = 0.2 } = {}) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: radius,
    fill: { color: C.white, transparency: fillT },
    line: hairline(),
  })
}

const BAR = 0.46 // macOS title bar height

// macOS-style window. Content should start at y + BAR + ~0.25.
function macWindow(slide, x, y, w, h, title) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.2,
    fill: { color: C.window, transparency: 4 },
    line: hairline(82),
    shadow: { type: 'outer', color: '000000', blur: 22, offset: 8, angle: 90, opacity: 0.5 },
  })
  ;[C.red, C.yellow, C.green].forEach((color, i) => {
    slide.addShape(pres.shapes.OVAL, {
      x: x + 0.26 + i * 0.21, y: y + (BAR - 0.13) / 2, w: 0.13, h: 0.13,
      fill: { color }, line: { color, width: 0 },
    })
  })
  if (title) {
    T(slide, title, { x, y, w, h: BAR, fontFace: MONO, fontSize: 10.5, color: C.muted, align: 'center', valign: 'middle' })
  }
  slide.addShape(pres.shapes.LINE, { x, y: y + BAR, w, h: 0, line: hairline(90) })
}

function pill(slide, x, y, w, label) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h: 0.36, rectRadius: 0.18,
    fill: { color: C.accent, transparency: 88 },
    line: hairline(45, C.accent),
  })
  T(slide, label, { x, y, w, h: 0.36, fontFace: MONO, fontSize: 10.5, bold: true, color: C.accent, align: 'center', valign: 'middle' })
}

function mythBox(slide, x, y, w, h, n, myth, now) {
  card(slide, x, y, w, h, { fillT: 91 })
  pill(slide, x + 0.28, y + 0.22, 1.3, `myth ${n}/6`)
  const bodyH = h - 0.92
  const mythH = Math.max(0.3, bodyH * 0.42) // one line minimum, or short boxes stack the two texts
  T(slide, myth, { x: x + 0.28, y: y + 0.72, w: w - 0.56, h: mythH, fontSize: 14, color: C.muted, strike: 'sngStrike' })
  T(slide, now, { x: x + 0.28, y: y + 0.72 + mythH, w: w - 0.56, h: Math.max(0.3, bodyH - mythH), fontSize: 14 })
}

function arrow(slide, x, y, w, h, o = {}) {
  slide.addShape(pres.shapes.LINE, {
    x, y, w, h, line: { color: C.muted, width: 1.25, endArrowType: 'triangle', ...o },
  })
}

function numeral(slide, x, y, n, size = 22) {
  T(slide, String(n).padStart(2, '0'), { x, y, w: 0.85, h: 0.5, fontFace: MONO, fontSize: size, bold: true, color: C.accent, valign: 'middle' })
}

// Refined showcase: pink emphasizes outcomes; blue identifies context and inputs.
function flowNode(s,x,y,w,h,title,detail,color=C.accent){
 card(s,x,y,w,h,{fillT:94})
 T(s,title,{x:x+.22,y:y+.20,w:w-.44,h:.35,fontSize:25,bold:true,color})
 T(s,detail,{x:x+.22,y:y+h-.36,w:w-.44,h:.25,fontSize:12.5,fontFace:MONO,color:C.muted})
}
{
 const s=newSlide({background:'bg-hero',footer:false})
 T(s,'INSTAAWARDS · 08 OCT 2026',{x:M,y:1.05,w:8,h:.3,fontFace:MONO,fontSize:11,color:C.blue,charSpacing:1.2})
 T(s,'Paiflow',{x:M,y:1.75,w:7,h:1.15,fontSize:76,bold:true,charSpacing:-2})
 T(s,'Draw how money moves.',{x:M,y:3.1,w:8.5,h:.8,fontSize:34,bold:true,color:C.accent,charSpacing:-.5})
 T(s,'Visual payment flows on Stellar. Signed with your wallet.',{x:M,y:4.03,w:11.9,h:.5,fontSize:21,color:C.muted})
 const y=5.15,w=3.55,h=1.15,gap=(CW-3*w)/2
 ;[['Receive','XLM enters',C.blue],['Swap','Soroswap · XLM → USDC',C.accent],['Pay','USDC reaches a recipient',C.accent]].forEach(([t,d,c],i)=>{
  const x=M+i*(w+gap);flowNode(s,x,y,w,h,t,d,c);if(i<2)arrow(s,x+w+.10,y+h/2,gap-.2,0,{color:C.blue})
 })
 T(s,'Mychal Andres B. Pejana',{x:M,y:6.8,w:7,h:.3,fontSize:14,color:C.muted})
 T(s,'STELLAR TESTNET',{x:9.2,y:6.82,w:3.4,h:.3,fontFace:MONO,fontSize:10.5,color:C.blue,align:'right'})
}
{
 const s=newSlide({title:'A stronger payment path.',eyebrow:'THIS MONTH · FOUR DELIVERABLES',background:'bg-bl'})
 const w=(CW-.4)/2
 ;[['Real swaps','Soroswap execution with live quotes.'],['Developer API','Run the same flow from your backend.']].forEach(([title,desc],i)=>{
  const x=M+i*(w+.4);card(s,x,2.05,w,2.25,{fillT:92});
  T(s,`0${i+1}`,{x:x+.32,y:2.34,w:1,h:.3,fontFace:MONO,fontSize:13,color:C.blue})
  T(s,title,{x:x+.32,y:2.92,w:w-.64,h:.55,fontSize:30,bold:true,color:C.accent})
  T(s,desc,{x:x+.32,y:3.64,w:w-.64,h:.45,fontSize:18})
 })
 ;[['Clearer builder','Field validation, keyboard and mobile.'],['Verified end to end','Wallet + API runs, backed by receipts.']].forEach(([title,desc],i)=>{
  const x=M+i*(w+.4);card(s,x,4.62,w,1.45,{fillT:96});
  T(s,title,{x:x+.32,y:4.91,w:w-.64,h:.4,fontSize:23,bold:true})
  T(s,desc,{x:x+.32,y:5.48,w:w-.64,h:.36,fontSize:17,color:C.muted})
 })
 T(s,'7 SEP–4 OCT 2026 · ALL FOUR COMPLETE',{x:M,y:6.5,w:CW,h:.3,fontSize:11,color:C.blue,fontFace:MONO})
}
{
 const s=newSlide({title:'Watch the payment move.',eyebrow:'LIVE · STELLAR TESTNET'})
 const y=2.85,w=3.35,h=1.85,gap=(CW-3*w)/2
 ;[['Receive','10 XLM',C.blue],['Swap','XLM → USDC',C.accent],['Pay','Recipient wallet',C.accent]].forEach(([t,d,c],i)=>{
  const x=M+i*(w+gap);card(s,x,y,w,h,{fillT:93});
  T(s,t,{x:x+.3,y:y+.36,w:w-.6,h:.55,fontSize:32,bold:true,color:c})
  T(s,d,{x:x+.3,y:y+1.16,w:w-.6,h:.4,fontFace:MONO,fontSize:18,color:C.text})
  if(i<2)arrow(s,x+w+.16,y+h/2,gap-.32,0,{color:C.blue,width:1.5})
 })
}
{
 const s=newSlide({title:'From alpha to October.',eyebrow:'RESULTS → FORECAST',background:'bg-bl'})
 const bx=4.0,bw=5.9,bh=.40
 s.addShape(pres.shapes.RECTANGLE,{x:M,y:2.08,w:.15,h:.15,fill:{color:C.hot},line:{color:C.hot,width:0}})
 T(s,'Baseline',{x:M+.26,y:2.01,w:1.3,h:.3,fontSize:12,color:C.muted})
 s.addShape(pres.shapes.RECTANGLE,{x:2.2,y:2.08,w:.15,h:.15,fill:{color:C.hot,transparency:93},line:{color:C.accent,width:1,dashType:'dash'}})
 T(s,'October increase',{x:2.46,y:2.01,w:3,h:.3,fontSize:12,color:C.muted})
 T(s,'BASELINE → TARGET',{x:10.22,y:2.02,w:2.45,h:.3,fontFace:MONO,fontSize:10,color:C.blue})
 const rows=[['Users onboarded',9,45],['Flow deployments',42,110],['Unique flows designed',25,60],['Signed transactions',73,190],['Signing wallets',17,45],['Sandbox tries',8,60]]
 rows.forEach(([label,n,target],i)=>{
  const y=2.63+i*.52,f=bw*n/target,r=bw-f
  T(s,label,{x:M,y:y-.015,w:3.15,h:.4,fontSize:17,valign:'middle'})
  s.addShape(pres.shapes.RECTANGLE,{x:bx,y,w:f,h:bh,fill:{color:C.hot},line:{color:C.hot,width:0}})
  s.addShape(pres.shapes.RECTANGLE,{x:bx+f,y,w:r,h:bh,fill:{color:C.hot,transparency:93},line:{color:C.accent,width:1,dashType:'dash'}})
  T(s,`+${target-n}`,{x:bx+f,y,w:r,h:bh,fontFace:MONO,fontSize:14,bold:true,color:C.accent,align:'center',valign:'middle'})
  T(s,`${n} → ${target}+`,{x:10.22,y:y-.015,w:2.45,h:.4,fontFace:MONO,fontSize:16,bold:true,valign:'middle'})
 })
 T(s,'9 active testers · 8 external + 1 project member · 7 swap flows executed',{x:M,y:6.07,w:CW,h:.3,fontSize:13,color:C.muted})
 T(s,'Minimum forecast by 31 Oct; each bar has its own scale. Alpha: 30 Sep; sandbox: 1 Oct.',{x:M,y:6.53,w:CW,h:.3,fontSize:10.5,color:C.muted,fontFace:MONO})
}
{
 const s=newSlide({title:'Bring Paiflow to more builders.',eyebrow:'PLANNED EVENTS · OCTOBER'})
 const leftW=5.5,rightX=M+leftW+.4,rightW=CW-leftW-.4
 card(s,M,2.05,leftW,3.18,{fillT:92})
 T(s,'BUILDING WITH PAIFLOW',{x:M+.35,y:2.37,w:leftW-.7,h:.35,fontFace:MONO,fontSize:11,color:C.blue})
 T(s,'3 hackathons',{x:M+.35,y:2.99,w:leftW-.7,h:.8,fontFace:MONO,fontSize:35,bold:true,color:C.accent})
 T(s,'In collaboration with\nJRU + Web3 Iloilo + FEU Tech.',{x:M+.35,y:4.08,w:leftW-.7,h:.8,fontSize:20})
 ;[['Weekly builder sessions','Onboard and build after the hackathon.'],['BlockQuest Fiesta PH','Hands-on Paiflow booth in Laguna.']].forEach(([t,d],i)=>{
  const y=2.05+i*1.74;card(s,rightX,y,rightW,1.44,{fillT:96});
  T(s,t,{x:rightX+.3,y:y+.25,w:rightW-.6,h:.48,fontSize:22,bold:true})
  T(s,d,{x:rightX+.3,y:y+.9,w:rightW-.6,h:.35,fontSize:16,color:C.muted})
 })
 T(s,'AKLAN · NORTHWESTERN VISAYAN COLLEGE',{x:M,y:5.45,w:CW,h:.24,fontFace:MONO,fontSize:10.5,color:C.blue})
 T(s,'Join a university event to bring Paiflow to more students\nthrough a booth, a mini hackathon, or both.',{x:M,y:5.8,w:CW,h:.6,fontSize:16,color:C.muted})
 T(s,'Draw the flow. Sign it. Watch it land.',{x:M,y:6.47,w:CW,h:.32,fontSize:20,bold:true,color:C.accent})
 T(s,'paiflow.xyz',{x:10.8,y:6.54,w:1.8,h:.22,fontSize:10,fontFace:MONO,color:C.blue})
}
pres.author='Mychal Andres B. Pejana'
pres.subject='Five-minute InstaAwards showcase with a required live demo'
pres.writeFile({fileName:path.join(__dirname,'..','paiflow-showcase-webinar-design.pptx')})
