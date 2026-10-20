// Shared map renderer: the classic per-repo board and the hub both load this file.
// Pages supply the data (globals M, W) and may define renderBadge/renderZero/setupBoard; everything else lives here.
if(!document.documentElement.dataset.theme){try{document.documentElement.dataset.theme=localStorage.getItem('at-theme')==='light'?'light':'dark'}catch{document.documentElement.dataset.theme='dark'}}
let M=null,W=[],BP='',lastGraphKey='',graphPos={},regions={},minZoom=0.15,graphZoom=1,graphPan={x:0,y:0},graphSize={width:0,height:0},graphNeedsFit=true,panGesture=null
const openGraphDetails=new Set(),openGraphTasks=new Set(),closedGraphTasks=new Set(),closedGraphDetails=new Set()
function compLive(p){return p.status==='active'||(p.touchedAt&&Date.now()-p.touchedAt<60000)||((M&&M.runs)||[]).some(r=>!r.ended&&r.componentId===p.id)}
function isUnfolded(p){const k=ns(p.id);if(closedGraphDetails.has(k))return false;return openGraphDetails.has(k)||compLive(p)}
const ns=id=>BP+':'+id
const $=id=>document.getElementById(id)
const applyStyles=root=>{for(const n of root.querySelectorAll('[data-st]'))n.style.cssText=n.dataset.st}
function syncTheme(){const light=document.documentElement.dataset.theme==='light',toggle=$('theme-toggle'),label=$('theme-toggle-label');if(toggle){toggle.setAttribute('aria-checked',String(light));toggle.setAttribute('aria-label',light?'Use dark theme':'Use light theme')}if(label)label.textContent=light?'Dark':'Light';document.querySelector('meta[name="theme-color"]')?.setAttribute('content',light?'#fff':'#000')}
function toggleTheme(){const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('at-theme',next)}catch{}syncTheme()}
syncTheme()
$('theme-toggle')?.addEventListener('click',toggleTheme)
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const ago=ms=>{const s=Math.max(0,Math.round((Date.now()-ms)/1000));return s<60?`${s}s`:s<3600?`${Math.round(s/60)} min`:`${Math.round(s/3600)} h`}
const AGENT_COLORS={claude:'#d97757',codex:'var(--agent-openai)',chatgpt:'var(--agent-openai)',openai:'var(--agent-openai)',cursor:'#5b7fd6',human:'#8b8b93',k:'#8b8b93'}
const AGENT_ICONS={claude:'m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',codex:'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',chatgpt:'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',openai:'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'}
function agentIcon(n){return AGENT_ICONS[n.toLowerCase()]||null}
const AGENT_GLYPHS={cursor:'\u25c6'}
function agentGlyph(n){return AGENT_GLYPHS[n.toLowerCase()]||n[0].toUpperCase()}
function agentColor(n){const k=n.toLowerCase();if(AGENT_COLORS[k])return AGENT_COLORS[k];let h=0;for(const c of k)h=(h*31+c.charCodeAt(0))%360;return`hsl(${h} 45% 45%)`}
const statusLabel=s=>s==='done'?'Complete':s==='active'?'In progress':s==='blocked'?'Blocked':'Not started',pct=(done,total)=>total?Math.round(done/total*100):0
function kids(id){return M.plan.filter(n=>n.parent===id)}
const overlays={activity:true,runs:true}
try{Object.assign(overlays,JSON.parse(localStorage.getItem('at-overlays')||'{}'))}catch{}
function applyOverlays(){document.body.classList.toggle('hide-activity',!overlays.activity);document.body.classList.toggle('hide-runs',!overlays.runs)
  const a=$('ov-activity'),r=$('ov-runs');if(a)a.classList.toggle('ov-off',!overlays.activity);if(r)r.classList.toggle('ov-off',!overlays.runs)}
function toggleOverlay(k){overlays[k]=!overlays[k];try{localStorage.setItem('at-overlays',JSON.stringify(overlays))}catch{};applyOverlays()}
function fitWorld(){const stage=$('graph-stage');if(!stage||!graphSize.width)return;const box=stage.getBoundingClientRect();graphZoom=Math.max(minZoom,Math.min((box.width-80)/graphSize.width,(box.height-80)/graphSize.height));graphPan={x:(box.width-graphSize.width*graphZoom)/2,y:(box.height-graphSize.height*graphZoom)/2};updateTransform()}
function flyToRegion(port){const r=regions[port];if(!r)return;const stage=$('graph-stage');if(!stage)return;const box=stage.getBoundingClientRect()
  const z=Math.max(.45,Math.min(1.1,(box.width-128)/r.w,(box.height-128)/r.h))
  const world=$('world');if(world){world.style.transition='transform 600ms cubic-bezier(.23,1,.32,1)';setTimeout(()=>{if(world)world.style.transition=''},650)}
  graphZoom=z;graphPan={x:(box.width-r.w*z)/2-r.ox*z,y:(box.height-r.h*z)/2-r.oy*z};updateTransform()}
function isSkeletonPlan(){return M.plan.filter(n=>n.level==='task').length<=1&&!hasSyntheticPlan(M)}
function hasSyntheticPlan(b){return(b.plan||[]).some(n=>n.synthetic)}
function boardLayout(b){
  const phases=b.plan.filter(n=>n.level==='component')
  const groups=[...new Set(phases.map(p=>p.laneLabel||''))]
  if(groups.length<2)return laneLayout(phases)
  const byId=Object.fromEntries(phases.map(p=>[p.id,p])),pos={},lanes=[];let y=0,width=560
  for(const g of groups){const sub=laneLayout(phases.filter(p=>(p.laneLabel||'')===g));lanes.push({label:g,y});for(const[id,q]of Object.entries(sub.pos))pos[id]={...q,y:q.y+y+44,nodeY:q.nodeY+y+44};y+=sub.height+44;width=Math.max(width,sub.width)}
  return{phases,byId,pos,width,height:y,lanes}
}
function laneLayout(phases){
  const byId=Object.fromEntries(phases.map(p=>[p.id,p])),depth={},visiting=new Set()
  function getDepth(p){if(depth[p.id]!=null)return depth[p.id];if(visiting.has(p.id))return 0;visiting.add(p.id);const preds=p.needs.filter(id=>byId[id]);depth[p.id]=preds.length?1+Math.max(...preds.map(id=>getDepth(byId[id]))):0;visiting.delete(p.id);return depth[p.id]}
  phases.forEach(getDepth);const cols={};phases.forEach(p=>(cols[depth[p.id]]??=[]).push(p));const gx=120,gy=48,pad=64,pos={},metrics=Object.fromEntries(phases.map(p=>[p.id,graphNodeMetrics(p)])),columnWidths={}
  for(const[col,list]of Object.entries(cols))columnWidths[col]=Math.max(...list.map(p=>metrics[p.id].w))
  const orderedColumns=Object.keys(cols).map(Number).sort((a,b)=>a-b),columnX={};let nextX=pad
  const MAX_NODES_PER_RANK=4,rankWraps={}
  for(const col of orderedColumns){const list=cols[col];if(list.length>MAX_NODES_PER_RANK){const cols_needed=Math.ceil(list.length/MAX_NODES_PER_RANK);rankWraps[col]={cols:cols_needed,perCol:Math.ceil(list.length/cols_needed)}}
    const w=columnWidths[col],actualW=rankWraps[col]?columnWidths[col]*rankWraps[col].cols+gx*(rankWraps[col].cols-1):w;columnX[col]=nextX;nextX+=actualW+gx}
  let maxBottom=pad
  for(const[col,list]of Object.entries(cols)){const wrap=rankWraps[col];const subRowGap=wrap?gy/2:gy
    if(wrap){const colWidth=columnWidths[col];const rows=Math.ceil(list.length/wrap.cols)
      const maxHeights=Array(wrap.cols).fill(0)
      for(let i=0;i<list.length;i++){const sc=i%wrap.cols,sr=Math.floor(i/wrap.cols);maxHeights[sc]=Math.max(maxHeights[sc],metrics[list[i].id].h)}
      let nextY=pad
      for(let sr=0;sr<rows;sr++){let colNextY=nextY
        for(let sc=0;sc<wrap.cols;sc++){const idx=sr*wrap.cols+sc;if(idx>=list.length)continue
          const p=list[idx],size=metrics[p.id],baseX=columnX[col]+sc*(colWidth+gx),x=baseX+(colWidth-size.w)/2,y=nextY
          pos[p.id]={x,y,...size,nodeX:x+(size.w-size.nodeW)/2,nodeY:y}
          colNextY=Math.max(colNextY,y+size.h)}
        nextY=colNextY+subRowGap}
      maxBottom=Math.max(maxBottom,nextY-subRowGap+pad)}
    else{let nextY=pad
      for(const p of list){const size=metrics[p.id],x=columnX[col]+(columnWidths[col]-size.w)/2
        pos[p.id]={x,y:nextY,...size,nodeX:x+(size.w-size.nodeW)/2,nodeY:nextY};nextY+=size.h+subRowGap}
      maxBottom=Math.max(maxBottom,nextY-subRowGap+pad)}}
  return{phases,byId,pos,width:Math.max(nextX-gx+pad,560),height:Math.max(maxBottom,300)}
}
function boardInnerHtml(b,L){
  const {phases,byId,pos}=L
  const seenLinks=new Set(),linkPairs=[]
  for(const p of phases)for(const l of p.links||[]){if(!byId[l])continue;const key=[p.id,l].sort().join('|');if(seenLinks.has(key))continue;seenLinks.add(key);linkPairs.push([byId[l],p])}
  const traveled={}
  for(const r of (b.runs||[])){
    const path=(r.path||[])
    for(let i=1;i<path.length;i++){
      if(Date.now()-path[i].at>45*60e3)continue
      traveled[path[i-1].c+'|'+path[i].c]={agent:r.agent,at:path[i].at}
    }
  }
  const trails=(b.runs||[]).map(r=>{
    const ids=[...(r.path||[]).map(x=>x.c)];if(r.componentId&&ids[ids.length-1]!==r.componentId)ids.push(r.componentId)
    const pts=ids.map(id=>pos[id]).filter(Boolean).map(q=>`${q.nodeX+200},${q.nodeY+64}`)
    return pts.length>1?`<polyline class="trail" points="${pts.join(' ')}" stroke="${agentColor(r.agent)}" data-st="opacity:${r.ended?0.2:0.55}"/>`:''
  }).join('')
  const edges=trails+phases.flatMap(p=>p.needs.map(need=>graphEdge(byId[need],p,pos,traveled[need+'|'+p.id]))).join('')+linkPairs.map(([a,b2])=>graphLinkEdge(a,b2,pos,traveled[a.id+'|'+b2.id]||traveled[b2.id+'|'+a.id])).join('')
  const nodes=phases.map((p,i)=>graphNode(p,i,pos[p.id])).join('')
  const laneTags=(L.lanes||[]).map(l=>`<text x="64" y="${l.y+36}" fill="var(--faint)" font-size="15" font-weight="600" font-family="var(--mono)" letter-spacing=".04em">${esc(l.label)}</text>`).join('')
  return laneTags+edges+nodes
}
function regionCardHtml(b,L){
  const w=L.width,h=L.height
  const live=(b.runs||[]).filter(r=>!r.ended)
  const sq=b.plan.filter(n=>n.level==='component').map((c,i)=>`<rect x="${40+i*30}" y="${h/2+4}" width="20" height="20" rx="5" fill="${c.status==='done'?'#3f7f57':c.status==='blocked'?'var(--danger)':'none'}" stroke="${c.status==='active'?'var(--accent)':'var(--faint)'}" stroke-width="2.5"/>`).join('')
  const marks=live.map((r,i)=>{const ic=agentIcon(r.agent);return ic?`<g transform="translate(${40+i*34} ${h/2+44}) scale(1.1)"><path fill="${agentColor(r.agent)}" d="${ic}"/></g>`:''}).join('')
  return`<text x="40" y="${h/2-36}" fill="var(--text)" font-size="44" font-weight="650" font-family="var(--font)" letter-spacing="-1">${esc(b.project)}</text>${sq}${marks}${(!b.hasPlan&&!hasSyntheticPlan(b))?`<text x="40" y="${h/2+44}" fill="var(--faint)" font-size="16" font-family="var(--font)">nothing mapped yet</text><g class="setup-btn" data-act="setup" data-port="${b.port}" data-st="cursor:pointer"><rect x="40" y="${h/2+64}" width="172" height="40" rx="11" fill="var(--accent-bg)" stroke="var(--accent)" stroke-width="1.2"/><text x="126" y="${h/2+89}" text-anchor="middle" fill="var(--accent)" font-size="15.5" font-weight="600" font-family="var(--font)">Set up the map</text></g>`:(!b.hasPlan&&hasSyntheticPlan(b))?`<text x="40" y="${h/2+44}" fill="var(--faint)" font-size="16" font-family="var(--font)">live from todos, no plan file yet</text>`:''}${live.length?`<text x="${w-40}" y="${h/2-36}" text-anchor="end" fill="var(--dim)" font-size="16" font-family="var(--font)">${live.length} running</text>`:''}`
}
const CARD_LOD=0.3
let _saved=null
function setBoardGlobals(b){_saved={M,BP};M={...b,session:{project:b.project},tree:(M&&M.port===b.port)?M.tree:[]};BP=String(b.port)}
function restoreBoardGlobals(){if(_saved){M=_saved.M;BP=_saved.BP;_saved=null}}
function renderGraph(){
  const boards=boardsAll()
  if(!boards.length)return
  if(boards.length===1&&typeof renderZero==='function'&&M&&((!M.hasPlan&&!hasSyntheticPlan(M))||isSkeletonPlan())){renderZero();return}
  regions={};graphPos={}
  const GAP=160,ROWMAX=3600;let cx=80,cy=80,rowH=0
  let content=''
  const realM=M,realBP=BP
  for(const b of boards){
    const eff=(realM&&b.port===realM.port)?{...realM,project:realM.session.project}:b
    M=eff;BP=String(b.port)
    const L=boardLayout(eff)
    if(cx>80&&cx+L.width>ROWMAX){cx=80;cy+=rowH+GAP;rowH=0}
    const ox=cx,oy=cy
    regions[b.port]={ox,oy,w:L.width,h:L.height+56,project:eff.project||b.project}
    for(const[id,q]of Object.entries(L.pos))graphPos[BP+':'+id]={...q,nodeX:q.nodeX+ox,nodeY:q.nodeY+56+oy}
    const hot=eff.activity&&Date.now()-eff.activity.at<60000
    const cardMode=graphZoom<CARD_LOD||!eff.hasPlan
    content+=`<g transform="translate(${ox} ${oy})"><rect width="${L.width}" height="${L.height+56}" rx="26" fill="var(--region)" stroke="${hot?'rgba(233,162,59,.5)':'var(--line)'}" stroke-width="1.5"/><text x="28" y="38" fill="var(--faint)" font-size="15" font-weight="600" font-family="var(--mono)" letter-spacing=".08em">${esc((eff.project||'').toUpperCase())}${eff.planStale&&eff.planStale.stale?`<tspan fill="var(--accent)"> · PLAN BEHIND</tspan>`:''}${hasSyntheticPlan(eff)?`<tspan fill="var(--dim)"> · LIVE TODOS, NO PLAN FILE</tspan>`:''}</text>${cardMode?regionCardHtml(eff,L):`<g transform="translate(0 56)">${boardInnerHtml(eff,L)}</g>`}</g>`
    cx+=L.width+GAP;rowH=Math.max(rowH,L.height+56)
  }
  M=realM;BP=realBP
  const width=Math.max(...Object.values(regions).map(r=>r.ox+r.w))+80
  const height=Math.max(...Object.values(regions).map(r=>r.oy+r.h))+80
  graphSize={width,height}
  minZoom=Math.max(0.06,Math.min(920/width,700/height)*0.75)
  $('graph').innerHTML=`<svg class="graph-grid"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--grid)"/></pattern></defs><rect width="100%" height="100%" fill="url(#grid)"/></svg><div class="graph-stage" id="graph-stage"><svg class="graph-svg"><title>World map</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" fill="var(--grid)"/></marker></defs><g class="world" id="world" transform="translate(${graphPan.x} ${graphPan.y}) scale(${graphZoom})">${content}</g></svg></div><div class="canvas-tools"><button class="icon" aria-label="Zoom out" data-act="zoom-out"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button><span class="zoom" id="zoom">${Math.round(graphZoom*100)}%</span><button class="icon" aria-label="Zoom in" data-act="zoom-in"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></button><span class="divider"></span><button class="icon" id="ov-activity" aria-label="Activity overlay" title="Activity overlay" data-act="ov-activity"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg></button><button class="icon" id="ov-runs" aria-label="Runs overlay" title="Runs overlay" data-act="ov-runs"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="6" rx="2"/><rect x="4" y="14" width="10" height="5" rx="2"/></svg></button><span class="divider"></span><button class="icon" aria-label="Fit world" title="Fit the whole world" data-act="fit-world"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></button><button class="icon" aria-label="Fit my repo" title="Fit this repo" data-act="fit-graph"><svg viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/></svg></button></div>`
  applyStyles($('graph'));renderMinimap();applyOverlays();$('graph-stage').addEventListener('wheel',onGraphWheel,{passive:false});if(graphNeedsFit){graphNeedsFit=false;requestAnimationFrame(fitGraph)}
}
function graphDetailHeight(p){const list=kids(p.id),openRows=list.filter(graphTaskIsOpen).reduce((a,t)=>a+16+Math.max(graphTaskDetails(t).rows.length,5)*20,0);const sessN=(M.runs||[]).filter(r=>r.componentId===p.id).reduce((a,r)=>a+(r.todos||[]).length,0)+((p.touchedAt&&Date.now()-p.touchedAt<60000&&!list.some(k=>k.status==='active'||k.status==='blocked'))?1:0);const maxListHeight=list.length>3?Math.min((list.length+sessN)*44+Math.max(0,list.length+sessN-1)+openRows,360):undefined;return (list.length+sessN)?(list.length+sessN)*44+Math.max(0,list.length+sessN-1)+openRows:64}
function graphNodeMetrics(p){const nodeW=400;let nodeH=128;if(fileMode&&(p.filesList||[]).length)nodeH=110+Math.ceil(Math.min(p.filesList.length,8)/2)*24+(p.filesList.length>8?30:10);if(!isUnfolded(p))return{w:nodeW,h:nodeH,nodeW,nodeH,detailW:0,detailH:0};const detailW=400,detailH=graphDetailHeight(p);return{w:detailW,h:nodeH+24+detailH,nodeW,nodeH,detailW,detailH}}
function graphEdge(source,target,pos,handoff){if(!source||!pos[source.id]||!pos[target.id])return'';const a=pos[source.id],b=pos[target.id],x1=a.nodeX+a.nodeW,y1=a.nodeY+a.nodeH/2,x2=b.nodeX,y2=b.nodeY+b.nodeH/2,bend=Math.max(48,(x2-x1)/2),active=source.status==='active'||target.status==='active',d=`M${x1} ${y1}C${x1+bend} ${y1} ${x2-bend} ${y2} ${x2} ${y2}`
  if(handoff){const c=agentColor(handoff.agent),mx=(x1+x2)/2,my=(y1+y2)/2-10
    return`<path class="edge handoff" d="${d}" data-st="stroke:${c}" marker-end="url(#arrow)"/><text x="${mx}" y="${my}" text-anchor="middle" fill="${c}" font-size="10.5" font-weight="650" font-family="var(--mono)">${esc(handoff.agent)} ⇢</text>`}
  return`<path class="edge ${active?'active':''}" d="${d}" marker-end="url(#arrow)"/>`}
function graphLinkEdge(a,b,pos){const A=pos[a.id],B=pos[b.id];if(!A||!B)return''
  let x1,y1,x2,y2,d
  if(Math.abs(A.nodeX-B.nodeX)>24){const L=A.nodeX<B.nodeX?A:B,R=A.nodeX<B.nodeX?B:A;x1=L.nodeX+L.nodeW;y1=L.nodeY+L.nodeH/2;x2=R.nodeX;y2=R.nodeY+R.nodeH/2;const mx=(x1+x2)/2;d=`M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
  else{const T=A.nodeY<B.nodeY?A:B,Bt=A.nodeY<B.nodeY?B:A;x1=T.nodeX+T.nodeW/2;y1=T.y+T.h;x2=Bt.nodeX+Bt.nodeW/2;y2=Bt.nodeY;const my=(y1+y2)/2;d=`M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`}
  if(arguments[3]){const h=arguments[3],c=agentColor(h.agent)
    return`<path class="edge handoff" d="${d}" data-st="stroke:${c}"/><text x="${(x1+x2)/2}" y="${(y1+y2)/2-8}" text-anchor="middle" fill="${c}" font-size="10.5" font-weight="650" font-family="var(--mono)">${esc(h.agent)} ⇢</text>`}
  return`<path class="edge link" d="${d}"/>`}
function graphNode(p,index,pos){return collapsedGraphNode(p,index,pos)+(!fileMode&&isUnfolded(p)?expandedGraphNode(p,pos):'')}
function graphTaskIsOpen(task){if(openGraphTasks.has(ns(task.id)))return true;if(closedGraphTasks.has(ns(task.id)))return false;const parent=M.plan.find(p=>p.id===task.parent),siblingCount=(parent?kids(parent.id):M.plan).length;return task.status==='active'&&siblingCount<=3}
function graphTaskMarker(task,index){if(task.status==='done')return`<span class="task-capsule-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>`;if(task.status==='blocked')return`<span class="task-capsule-badge blocked" aria-hidden="true">!</span>`;return`<span class="task-capsule-marker" aria-hidden="true"><svg viewBox="0 0 24 24"><circle class="ring-track" cx="12" cy="12" r="11"/><circle class="ring-live" cx="12" cy="12" r="11"/></svg><span>${index+1}</span></span>`}
function graphTaskDetails(task){const comp=M.plan.find(x=>x.id===task.parent),compActive=M.plan.some(x=>x.parent===task.parent&&x.status==='active')
  const live=!!(comp&&(comp.recent||[]).length&&(task.status==='active'||task.status==='blocked'||(task.status==='done'&&!compActive)))
  const rows=live?comp.recent.slice(0,4).map(a=>({label:a.file+(a.n>1?` ×${a.n}`:''),meta:ago(a.at)})):[]
  if(task.tech)rows.push({label:task.tech,meta:''})
  if(!rows.length)rows.push({label:'No activity recorded yet',meta:''})
  return{rows,live,comp}}
function graphSessionRow(t,i,ended){const st=t.status==='completed'?'done':t.status==='in_progress'?'active':'pending'
  const marker=st==='done'?`<span class="task-capsule-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>`:`<span class="task-capsule-marker" aria-hidden="true"><svg viewBox="0 0 24 24"><circle class="ring-track" cx="12" cy="12" r="11"/><circle class="ring-live" cx="12" cy="12" r="11"/></svg><span>${i+1}</span></span>`
  return`<div class="task-capsule sess ${st}${ended?' sess-ended':''}" role="listitem"><button class="task-capsule-button" type="button" data-st="cursor:default"><span class="task-capsule-marker-wrap">${marker}</span><span class="task-capsule-copy">${esc(t.content)}</span><span class="task-capsule-pill now">Session plan</span></button></div>`}
function graphTaskRow(task,index){const open=graphTaskIsOpen(task),details=graphTaskDetails(task),pill=task.status==='blocked'?'<span class="task-capsule-pill blocked">Blocked</span>':task.status==='done'?'<span class="task-capsule-pill">Completed</span>':task.status==='pending'&&task.src==='agent'?'<span class="task-capsule-pill now">Session plan</span>':task.status==='pending'&&task.src==='roadmap'?'<span class="task-capsule-pill backlog">Roadmap</span>':'',amount=task.status==='active'?'Editing now':'';return`<div class="task-capsule ${task.status} ${open?'open':''}" data-task="${ns(task.id)}" role="listitem" data-st="animation-delay:${index*80}ms"><button class="task-capsule-button" type="button" aria-expanded="${open}" data-act="task" data-tid="${ns(task.id)}"><span class="task-capsule-marker-wrap">${graphTaskMarker(task,index)}</span><span class="task-capsule-copy">${esc(task.title)}</span>${task.by?`<span class="agent-chip${task.status==='done'?' faded':''}" data-st="color:${agentColor(task.by)}" title="${esc(task.by)}">${agentIcon(task.by)?`<svg viewBox="0 0 24 24" width="14" height="14"><path fill="${agentColor(task.by)}" d="${agentIcon(task.by)}"/></svg>`:agentGlyph(task.by)}</span>`:''}${amount?`<span class="task-capsule-amount">${amount}</span>`:''}${pill}<span class="task-capsule-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></button><div class="task-capsule-detail"><div class="task-capsule-detail-clip"><div class="task-capsule-detail-grid"><span class="task-capsule-detail-line" aria-hidden="true"></span><div class="task-capsule-detail-list" data-dl-task="${ns(task.id)}" data-dl-comp="${task.parent?ns(task.parent):''}" data-tech="${esc(task.tech||'')}">${details.rows.map((detail,i)=>`<div class="task-capsule-detail-row" data-st="animation-delay:${120+i*80}ms"><span>${esc(detail.label)}</span><span class="task-capsule-detail-meta">${esc(detail.meta)}</span></div>`).join('')}</div></div></div></div></div>`}
function nodeStatusIcon(p,w){const cx=w-26,cy=26
  if(p.kind==='human'&&p.status!=='done')return`<g><circle cx="${cx}" cy="${cy}" r="9" fill="var(--accent)"/><text x="${cx}" y="${cy+4}" text-anchor="middle" fill="#141414" font-size="12" font-weight="700" font-family="var(--font)">!</text><title>waiting on a human</title></g>`
  if(p.status==='done')return`<g><circle cx="${cx}" cy="${cy}" r="9" fill="#3f7f57"/><path d="M${cx-4.5} ${cy} l3.2 3.2 l6-6.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`
  if(p.status==='active')return`<g><circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="var(--line)" stroke-width="2"/><circle class="node-spin" cx="${cx}" cy="${cy}" r="9" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-dasharray="16 41"/></g>`
  if(p.status==='blocked')return`<g><circle cx="${cx}" cy="${cy}" r="9" fill="var(--danger)"/><text x="${cx}" y="${cy+4}" text-anchor="middle" fill="#fff" font-size="12" font-weight="700" font-family="var(--font)">!</text></g>`
  return`<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="var(--faint)" stroke-width="2"/>`}
function nodeAgentChips(p,w){const names=[...new Set(M.plan.filter(n=>n.parent===p.id&&(n.status==='active'||n.status==='blocked')&&n.by).map(n=>n.by))].slice(0,3)
  return names.map((n,i)=>{const cx=w-26-24*(i+1),icon=agentIcon(n),c=agentColor(n)
    const mark=icon?`<g transform="translate(${cx-6.5} ${19.5}) scale(0.5417)"><path fill="${c}" d="${icon}"/></g>`:`<text x="${cx}" y="30" text-anchor="middle" fill="${c}" font-size="11" font-weight="700" font-family="var(--font)">${agentGlyph(n)}</text>`
    return`<g>${mark}<title>${esc(n)}</title></g>`}).join('')}
const FILE_ICONS={
  code:'<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
  image:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 5-5 4 4 2-2 3 3"/>',
  page:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M6 6.5h.01M9 6.5h.01"/>',
  doc:'<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7"/>',
  data:'<path d="M9 4c-2 0-3 1-3 3v2c0 1-.7 2-2 2 1.3 0 2 1 2 2v3c0 2 1 3 3 3M15 4c2 0 3 1 3 3v2c0 1 .7 2 2 2-1.3 0-2 1-2 2v3c0 2-1 3-3 3"/>',
  shell:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  file:'<path d="M6 3h9l4 4v14H6z"/>'
}
function fileIcon(f){
  const e=(f.split('.').pop()||'').toLowerCase()
  if(['html','htm'].includes(e))return FILE_ICONS.page
  if(['png','jpg','jpeg','gif','svg','webp','ico','icns'].includes(e))return FILE_ICONS.image
  if(['py','js','mjs','ts','tsx','jsx','swift','go','rb','rs','c','cc','cpp','h','java','kt','css','scss'].includes(e))return FILE_ICONS.code
  if(['md','txt','rst'].includes(e))return FILE_ICONS.doc
  if(['json','yaml','yml','toml','plist','xml'].includes(e))return FILE_ICONS.data
  if(['sh','bash','zsh','fish'].includes(e))return FILE_ICONS.shell
  return FILE_ICONS.file
}
function fileFamily(f){
  const base=f.split('/').pop(),di=base.lastIndexOf('.')
  const ext=di>0?base.slice(di):'',stem=di>0?base.slice(0,di):base
  const toks=stem.split(/[-_.]/)
  while(toks.length>1&&/^(\d+x?\d*|dark|light|black|white|master|small|large|\dx|[0-9a-f]{6,})$/i.test(toks[toks.length-1]))toks.pop()
  return toks.join('-')+ext
}
function fileConstellation(p,w){
  const files=(p.filesList||[]).slice()
  if(!files.length)return''
  const hot=M.hotFiles||{}
  const isHot=f=>hot[f]&&Date.now()-hot[f]<60000
  // cluster variant families (3+ files sharing a stem) into one distinct row
  const fam={}
  for(const f of files)(fam[fileFamily(f)]=fam[fileFamily(f)]||[]).push(f)
  const items=[]
  for(const[key,members]of Object.entries(fam)){
    if(members.length>=3){
      const di=key.lastIndexOf('.'),label=(di>0?key.slice(0,di)+'-*'+key.slice(di):key+'-*')
      items.push({label:`${label}`,count:members.length,files:members,heat:Math.max(...members.map(f=>hot[f]||0)),hot:members.some(isHot),icon:members[0]})
    }else for(const f of members){
      const base=f.split('/').pop()
      items.push({label:base.length>21?base.slice(0,12)+'…'+base.slice(-7):base,count:1,files:[f],heat:hot[f]||0,hot:isHot(f),icon:f})
    }
  }
  items.sort((a,b)=>b.heat-a.heat)
  const shown=items.slice(0,8)
  const restFiles=items.slice(8).reduce((a,x)=>a+x.count,0)
  const run=(M.runs||[]).find(r=>!r.ended&&r.componentId===p.id)
  const hottest=shown.filter(x=>x.hot).sort((a,b)=>b.heat-a.heat)[0]
  let out=''
  shown.forEach((it,i)=>{
    const col=i%2,row=Math.floor(i/2),x=16+col*186,y=104+row*24
    out+=`<g class="file-ic${it.hot?' hot':''}" transform="translate(${x-1} ${y-1}) scale(0.62)">${fileIcon(it.icon)}<title>${esc(it.files.join('\n'))}</title></g>`
    out+=`<text class="file-label${it.hot?' hot':''}" x="${x+19}" y="${y+11}">${esc(it.label)}${it.count>1?` <tspan data-st="opacity:.6">×${it.count}</tspan>`:''}</text>`
    if(it===hottest&&run){const ic=agentIcon(run.agent);if(ic)out+=`<g transform="translate(${x} ${y-15}) scale(0.5)"><path fill="${agentColor(run.agent)}" d="${ic}"/></g>`}
  })
  if(restFiles>0)out+=`<text class="file-label" x="16" y="${104+Math.ceil(shown.length/2)*24+16}" data-st="opacity:.55">+ ${restFiles} more files</text>`
  return out
}
function handoffLabel(p,w,h){
  const hs=(M.handoffs||[]).filter(x=>x.c===p.id&&Date.now()-x.at<10*60e3)
  if(!hs.length)return''
  const x=hs[hs.length-1]
  return`<text class="handoff-label" x="${w-16}" y="${h-12}" text-anchor="end"><tspan fill="${agentColor(x.from)}">${esc(x.from)}</tspan><tspan fill="var(--faint)"> ⇄ </tspan><tspan fill="${agentColor(x.to)}">${esc(x.to)}</tspan></text>`
}
function collapsedGraphNode(p,index,pos){const list=kids(p.id),done=list.filter(n=>n.status==='done').length,progress=pct(done,list.length),label=p.title.length>28?`${p.title.slice(0,27)}…`:p.title,isOpen=isUnfolded(p),w=pos.nodeW,h=pos.nodeH,obsWord=p.status==='done'?'Revising':p.status==='blocked'?'Retrying':'Editing',chipN=new Set(M.plan.filter(n=>n.parent===p.id&&(n.status==='active'||n.status==='blocked')&&n.by).map(n=>n.by)).size;return`<g class="gnode ${p.status} ${p.kind==='knowledge'?'knowledge':p.kind==='human'?'human':''} ${isOpen?'selected':''}" data-id="${ns(p.id)}" transform="translate(${pos.nodeX} ${pos.nodeY})" role="button" tabindex="0" aria-expanded="${isOpen}" aria-label="${isOpen?'Hide':'Show'} tasks for ${esc(p.title)}" data-act="node"><rect class="node-box" width="${w}" height="${h}" rx="12"/><circle class="port" cx="0" cy="${h/2}" r="4"/><circle class="port" cx="${w}" cy="${h/2}" r="4"/><text class="kicker" x="16" y="24">${esc((p.tech||'#'+p.id).slice(0,Math.min(42,Math.floor((w-170)/6.8))))}</text><text class="obs-label obs-file" x="${w-16}" y="76" text-anchor="end" fill="var(--accent)" font-size="11" font-family="var(--mono)"></text>${nodeStatusIcon(p,w)}<circle class="obs-ring" cx="${w-26}" cy="26" r="13" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-dasharray="23 59"/><text class="obs-label" x="${w-44-24*Math.min(chipN,3)}" y="30" text-anchor="end" fill="var(--accent)" font-size="11" font-weight="600" font-family="var(--font)">${obsWord}</text>${nodeAgentChips(p,w)}<text class="node-title" x="16" y="52">${esc(label)}</text><text class="node-meta" x="16" y="76">${done} of ${list.length} tasks · ${p.status==='pending'&&done>0?'Underway':statusLabel(p.status)}</text><rect class="progress-bg" x="16" y="92" width="${w-32}" height="4" rx="2"/><rect class="progress" x="16" y="92" width="${(w-32)*progress/100}" height="4" rx="2"/>${fileMode?fileConstellation(p,w):`<text class="node-action" x="16" y="116">${isOpen?'HIDE TASKS ↑':'SHOW TASKS ↓'}</text>`}${p.url?`<g class="node-url" data-act="url" data-url="${esc(p.url)}"><rect x="${w-96}" y="104" width="84" height="18" rx="5" fill="transparent"/><text x="${w-16}" y="117" text-anchor="end">OPEN ↗</text></g>`:''}${handoffLabel(p,w,h)}${list.some(k=>k.status==='pending'&&k.src==='agent')?`<text x="${w-16}" y="116" text-anchor="end" fill="#e08bb8" font-size="10" font-weight="700" font-family="var(--mono)" letter-spacing=".06em">SESSION PLAN</text>`:''}</g>`}
function expandedGraphNode(p,pos){
  const list=kids(p.id),detailY=pos.nodeY+pos.nodeH+24,centerX=pos.nodeX+pos.nodeW/2
  const sessRows=(M.runs||[]).filter(r=>r.componentId===p.id).flatMap(r=>(r.todos||[]).map((t,i)=>graphSessionRow(t,i,r.ended))).join('')
  const liveNow=p.touchedAt&&Date.now()-p.touchedAt<60000,declaredKid=list.some(k=>k.status==='active'||k.status==='blocked')
  const liveSess=(M.runs||[]).some(r=>r.componentId===p.id&&!r.ended&&(r.todos||[]).length)
  const a0=(p.recent||[])[0]
  const obsRow=liveNow&&!declaredKid&&!liveSess&&a0?`<div class="task-capsule active obsrow" role="listitem"><button class="task-capsule-button" type="button" data-st="cursor:default"><span class="task-capsule-marker-wrap"><span class="task-capsule-marker" aria-hidden="true"><svg viewBox="0 0 24 24"><circle class="ring-track" cx="12" cy="12" r="11"/><circle class="ring-live" cx="12" cy="12" r="11"/></svg></span></span><span class="task-capsule-copy" data-obs-copy="${ns(p.id)}">Revising · ${esc(a0.file.split('/').pop())}</span><span class="task-capsule-amount" data-obs-ago="${ns(p.id)}">${ago(a0.at)}</span></button></div>`:''
  const taskCount=list.length+sessRows.split('task-capsule').length-1+(obsRow?1:0)
  const hasScroll=taskCount>3
  const listStyle=hasScroll?'data-st="max-height:360px;overflow-y:auto;overflow-x:hidden"':''
  const tasks=(list.length||sessRows||obsRow)?`<div class="task-capsules list" role="list" aria-label="${esc(p.title)} tasks" ${listStyle}>${list.map(graphTaskRow).join('')}${sessRows}${obsRow}</div>`:'<div class="graph-task-empty">No tasks in this phase.</div>'
  return`<path class="detail-tether" d="M${centerX} ${pos.nodeY+pos.nodeH}V${detailY}"/><g class="graph-detail" data-detail="${ns(p.id)}" transform="translate(${pos.x} ${detailY})"><foreignObject width="${pos.detailW}" height="${pos.detailH}"><div xmlns="http://www.w3.org/1999/xhtml" class="graph-task-card">${tasks}</div></foreignObject></g>`
}
function toggleGraphNode(id,event){event?.stopPropagation()
  const boards=boardsAll(),ci=id.indexOf(':'),b=boards.find(x=>String(x.port)===id.slice(0,ci))
  const p=b&&b.plan.find(x=>x.id===id.slice(ci+1)&&x.level==='component')
  const auto=p&&(p.status==='active'||(p.touchedAt&&Date.now()-p.touchedAt<60000)||((b.runs||[]).some(r=>!r.ended&&r.componentId===p.id)))
  if(openGraphDetails.has(id)){openGraphDetails.delete(id);if(auto)closedGraphDetails.add(id)}
  else if(closedGraphDetails.has(id)){closedGraphDetails.delete(id);openGraphDetails.add(id)}
  else if(auto)closedGraphDetails.add(id)
  else openGraphDetails.add(id)
  renderGraph();renderTimes()}
function toggleGraphTask(id,event){event?.stopPropagation();const ci=id.indexOf(':'),port=id.slice(0,ci),raw=id.slice(ci+1);const b=W.find(x=>String(x.port)===port)||M;const task=b&&b.plan.find(n=>n.id===raw&&n.level==='task');if(!task)return
  const save=BP;BP=port
  if(graphTaskIsOpen(task)){openGraphTasks.delete(id);closedGraphTasks.add(id)}else{closedGraphTasks.delete(id);openGraphTasks.add(id)}
  BP=save;renderGraph();renderTimes()}
let zoomUnfolded=false,fileMode=false,cardMode=false
function updateTransform(){const world=$('world');if(world)world.setAttribute('transform',`translate(${graphPan.x} ${graphPan.y}) scale(${graphZoom})`);if($('zoom'))$('zoom').textContent=`${Math.round(graphZoom*100)}%`
  let dirty=false
  if(!zoomUnfolded&&graphZoom>=1.05){zoomUnfolded=true;for(const b of (W.length?W:(M?[M]:[])))for(const n of b.plan)if(n.level==='component')openGraphDetails.add(String(b.port)+':'+n.id);dirty=true}
  else if(zoomUnfolded&&graphZoom<=0.85){zoomUnfolded=false;openGraphDetails.clear();dirty=true}
  if(!fileMode&&graphZoom>=1.5){fileMode=true;dirty=true}
  else if(fileMode&&graphZoom<=1.3){fileMode=false;dirty=true}
  const cm=graphZoom<CARD_LOD;if(cm!==cardMode){cardMode=cm;dirty=true}
  if(dirty){renderGraph();renderTimes()}
  renderMinimapViewport()}
function fitGraph(){if(!M||!regions[M.port]){fitWorld();return}const r=regions[M.port];const stage=$('graph-stage');if(!stage)return;const box=stage.getBoundingClientRect();graphZoom=Math.max(.45,Math.min(1.2,(box.width-128)/r.w,(box.height-128)/r.h));graphPan={x:(box.width-r.w*graphZoom)/2-r.ox*graphZoom,y:(box.height-r.h*graphZoom)/2-r.oy*graphZoom};updateTransform()}
function zoomBy(factor,origin){const stage=$('graph-stage');if(!stage)return;const box=stage.getBoundingClientRect(),point=origin||{x:box.width/2,y:box.height/2},next=Math.max(minZoom,Math.min(1.8,graphZoom*factor)),wx=(point.x-graphPan.x)/graphZoom,wy=(point.y-graphPan.y)/graphZoom;graphPan={x:point.x-wx*next,y:point.y-wy*next};graphZoom=next;updateTransform()}
function onGraphWheel(e){e.preventDefault();const box=e.currentTarget.getBoundingClientRect();if(e.metaKey||e.ctrlKey)zoomBy(e.deltaY<0?1.08:.92,{x:e.clientX-box.left,y:e.clientY-box.top});else{graphPan.x-=e.deltaX;graphPan.y-=e.deltaY;updateTransform()}}
function startPan(e){if(e.target.closest('.gnode,.graph-detail'))return;const stage=$('graph-stage');stage.setPointerCapture(e.pointerId);stage.classList.add('dragging');panGesture={id:e.pointerId,x:e.clientX,y:e.clientY,panX:graphPan.x,panY:graphPan.y}}
function movePan(e){if(!panGesture||panGesture.id!==e.pointerId)return;graphPan={x:panGesture.panX+e.clientX-panGesture.x,y:panGesture.panY+e.clientY-panGesture.y};updateTransform()}
function endPan(e){if(!panGesture||panGesture.id!==e.pointerId)return;$('graph-stage')?.classList.remove('dragging');panGesture=null}
const MM_W=150
function renderMinimap(){
  const mm=$('minimap')
  if(!mm||!graphSize.width||M.plan.filter(n=>n.level==='component').length<2){if(mm)mm.style.display='none';return}
  mm.style.display=''
  const sc=MM_W/graphSize.width,h=Math.max(40,Math.round(graphSize.height*sc))
  const nodes=Object.entries(graphPos).map(([id,q])=>{
    const c=M.plan.find(n=>n.id===id)
    return`<rect class="mm-node ${c?c.status:''}" x="${q.nodeX*sc}" y="${q.nodeY*sc}" width="${q.nodeW*sc}" height="${Math.max(3,q.h*sc)}" rx="1.5"/>`
  }).join('')
  mm.innerHTML=`<svg width="${MM_W}" height="${h}" viewBox="0 0 ${MM_W} ${h}">${nodes}<rect class="mm-view" id="mm-view" x="0" y="0" width="10" height="10"/></svg>`
  mm.onclick=e=>{const r=mm.getBoundingClientRect(),wx=(e.clientX-r.left)/sc,wy=(e.clientY-r.top)/sc
    const stage=$('graph-stage'),box=stage.getBoundingClientRect()
    graphPan={x:box.width/2-wx*graphZoom,y:box.height/2-wy*graphZoom};updateTransform()}
  renderMinimapViewport()
}
function renderMinimapViewport(){
  const v=document.getElementById('mm-view');if(!v||!graphSize.width)return
  const stage=$('graph-stage');if(!stage)return
  const box=stage.getBoundingClientRect(),sc=MM_W/graphSize.width
  v.setAttribute('x',(-graphPan.x/graphZoom)*sc);v.setAttribute('y',(-graphPan.y/graphZoom)*sc)
  v.setAttribute('width',(box.width/graphZoom)*sc);v.setAttribute('height',(box.height/graphZoom)*sc)
}
function focusComp(id){const p=graphPos[id];const stage=$('graph-stage');if(!p||!stage)return
  const box=stage.getBoundingClientRect(),z=1.1
  const world=$('world');if(world){world.style.transition='transform 600ms cubic-bezier(.23,1,.32,1)';setTimeout(()=>{if(world)world.style.transition=''},650)}
  graphZoom=z;graphPan={x:box.width/2-(p.nodeX+200)*z,y:box.height/2-(p.nodeY+120)*z};updateTransform()}
function renderTimes(){if(M&&typeof renderBadge==='function')renderBadge();if(M)renderObserved();for(const el of document.querySelectorAll('.t-ago'))el.textContent=ago(+el.dataset.at)}
function boardsAll(){return (W.length?W:(M?[M]:[])).map(b=>({...b,project:b.project||(b.session&&b.session.project)||''}))}
function renderObserved(){const now=Date.now(),boards=boardsAll()
  const findB=port=>boards.find(x=>String(x.port)===port)
  for(const g of document.querySelectorAll('g.gnode[data-id]')){const key=g.dataset.id,ci=key.indexOf(':'),b=findB(key.slice(0,ci));if(!b)continue
    const comp=b.plan.find(x=>x.id===key.slice(ci+1)&&x.level==='component');if(!comp)continue
    const live=comp.touchedAt&&now-comp.touchedAt<60000
    g.classList.toggle('obs-live',!!live)
    const ft=g.querySelector('.obs-file'),a=(comp.recent||[])[0]
    if(ft)ft.textContent=live&&a?`${a.file.split('/').pop()}${a.n>1?` ×${a.n}`:''} · ${ago(a.at)}`:''}
  for(const g of document.querySelectorAll('g.graph-detail[data-detail]')){const key=g.dataset.detail,ci=key.indexOf(':'),port=key.slice(0,ci),b=findB(port);if(!b)continue
    const raw=key.slice(ci+1),comp=b.plan.find(x=>x.id===raw);if(!comp)continue
    const kidsOf=b.plan.filter(x=>x.parent===raw)
    const declared=kidsOf.some(x=>x.status==='active'||x.status==='blocked')
    const live=comp.touchedAt&&now-comp.touchedAt<60000
    const inferred=live&&!declared?(kidsOf.find(x=>x.status!=='done')||null):null
    for(const cap of g.querySelectorAll('.task-capsule[data-task]'))cap.classList.toggle('obs-spin',!!inferred&&cap.dataset.task===port+':'+inferred.id)
    for(const el of g.querySelectorAll('[data-dl-task]')){const traw=el.dataset.dlTask.slice(el.dataset.dlTask.indexOf(':')+1)
      const t=kidsOf.find(x=>x.id===traw);if(!t)continue
      const isLive=!!(comp.recent||[]).length&&(t.status==='active'||t.status==='blocked'||(inferred&&t.id===inferred.id)||(live&&!declared&&t.status==='done'&&!inferred))
      if(isLive){const rows=(comp.recent||[]).slice(0,4).map(a=>`<div class="task-capsule-detail-row"><span>${esc(a.file)}${a.n>1?` ×${a.n}`:''}</span><span class="task-capsule-detail-meta">${ago(a.at)}</span></div>`)
        if(el.dataset.tech)rows.push(`<div class="task-capsule-detail-row"><span data-st="opacity:.6">${esc(el.dataset.tech)}</span><span class="task-capsule-detail-meta"></span></div>`)
        el.innerHTML=rows.join('');applyStyles(el);el.dataset.obsLines='1'}
      else if(el.dataset.obsLines){const rows=[]
        if(el.dataset.tech)rows.push(`<div class="task-capsule-detail-row"><span>${esc(el.dataset.tech)}</span><span class="task-capsule-detail-meta"></span></div>`)
        if(!rows.length)rows.push('<div class="task-capsule-detail-row"><span>No activity recorded yet</span><span class="task-capsule-detail-meta"></span></div>')
        el.innerHTML=rows.join('');delete el.dataset.obsLines}}}
  for(const el of document.querySelectorAll('[data-obs-copy]')){const key=el.dataset.obsCopy,ci=key.indexOf(':'),b=findB(key.slice(0,ci))
    const comp=b&&b.plan.find(x=>x.id===key.slice(ci+1)),a=comp&&(comp.recent||[])[0]
    if(a)el.textContent=`Revising · ${a.file.split('/').pop()}${a.n>1?` ×${a.n}`:''}`}
  for(const el of document.querySelectorAll('[data-obs-ago]')){const key=el.dataset.obsAgo,ci=key.indexOf(':'),b=findB(key.slice(0,ci))
    const comp=b&&b.plan.find(x=>x.id===key.slice(ci+1)),a=comp&&(comp.recent||[])[0]
    if(a)el.textContent=ago(a.at)}}
window.addEventListener('resize',()=>{renderMinimapViewport()})
// Delegated map events: markup carries data-act, never an inline handler (the hub's CSP forbids them).
const mapHost=$('graph')
if(mapHost){
  mapHost.addEventListener('click',e=>{const t=e.target.closest('[data-act]');if(!t||!mapHost.contains(t))return
    const a=t.dataset.act
    if(a==='node')toggleGraphNode(t.dataset.id,e)
    else if(a==='task')toggleGraphTask(t.dataset.tid,e)
    else if(a==='url'){e.stopPropagation();window.open(t.dataset.url,'_blank')}
    else if(a==='setup'&&typeof setupBoard==='function')setupBoard(Number(t.dataset.port))
    else if(a==='zoom-out')zoomBy(.85)
    else if(a==='zoom-in')zoomBy(1.18)
    else if(a==='ov-activity')toggleOverlay('activity')
    else if(a==='ov-runs')toggleOverlay('runs')
    else if(a==='fit-world')fitWorld()
    else if(a==='fit-graph')fitGraph()})
  mapHost.addEventListener('keydown',e=>{const t=e.target.closest('[data-act="node"]');if(t&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleGraphNode(t.dataset.id,e)}})
  const onStage=fn=>e=>{if(e.target.closest('#graph-stage'))fn(e)}
  mapHost.addEventListener('pointerdown',onStage(startPan))
  mapHost.addEventListener('pointermove',onStage(movePan))
  mapHost.addEventListener('pointerup',onStage(endPan))
  mapHost.addEventListener('pointercancel',onStage(endPan))
}
