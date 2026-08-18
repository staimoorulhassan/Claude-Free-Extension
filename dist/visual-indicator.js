let s=null,n=null,t=null,c=!1,x=!1,m=!1;function y(){return m?{rgb:"239,68,68",hex:"#EF4444",fill:"#FEF2F2"}:{rgb:"59,130,246",hex:"#3B82F6",fill:"#EFF6FF"}}function v(){if(document.getElementById("claude-agent-styles"))return;const e=document.createElement("style");e.id="claude-agent-styles",e.textContent=`
    @keyframes claude-pulse {
      0%   { box-shadow: inset 0 0 12px rgba(59,130,246,0.55), inset 0 0 24px rgba(59,130,246,0.35), inset 0 0 40px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.6); }
      50%  { box-shadow: inset 0 0 18px rgba(59,130,246,0.80), inset 0 0 32px rgba(59,130,246,0.55), inset 0 0 50px rgba(59,130,246,0.25), 0 0 0 2px rgba(59,130,246,0.9); }
      100% { box-shadow: inset 0 0 12px rgba(59,130,246,0.55), inset 0 0 24px rgba(59,130,246,0.35), inset 0 0 40px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.6); }
    }
    @keyframes claude-pulse-boss {
      0%   { box-shadow: inset 0 0 12px rgba(239,68,68,0.55), inset 0 0 24px rgba(239,68,68,0.35), inset 0 0 40px rgba(239,68,68,0.15), 0 0 0 2px rgba(239,68,68,0.6); }
      50%  { box-shadow: inset 0 0 18px rgba(239,68,68,0.80), inset 0 0 32px rgba(239,68,68,0.55), inset 0 0 50px rgba(239,68,68,0.25), 0 0 0 2px rgba(239,68,68,0.9); }
      100% { box-shadow: inset 0 0 12px rgba(239,68,68,0.55), inset 0 0 24px rgba(239,68,68,0.35), inset 0 0 40px rgba(239,68,68,0.15), 0 0 0 2px rgba(239,68,68,0.6); }
    }
  `,document.head.appendChild(e)}function A(){s||(s=document.createElement("div"),s.id="claude-agent-glow-border",s.style.cssText=`
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 2147483646;
      opacity: 0; transition: opacity 0.3s ease-in-out;
    `,document.body.appendChild(s));const e=y();s.style.animation=`${m?"claude-pulse-boss":"claude-pulse"} 2s ease-in-out infinite`,s.style.boxShadow=`inset 0 0 12px rgba(${e.rgb},0.55), inset 0 0 24px rgba(${e.rgb},0.35), inset 0 0 40px rgba(${e.rgb},0.15), 0 0 0 2px rgba(${e.rgb},0.6)`,s.style.display="",requestAnimationFrame(()=>{s&&(s.style.opacity="1")})}function E(){s&&(s.style.opacity="0")}function F(){if(!n){n=document.createElement("div"),n.id="claude-agent-stop-container",n.style.cssText=`
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      display: flex; justify-content: center; align-items: center;
      pointer-events: none; z-index: 2147483647;
    `;const e=document.createElement("button");e.id="claude-agent-stop-button",e.innerHTML=`
      <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" style="margin-right:10px;vertical-align:middle;">
        <path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Zm40-112v56a12,12,0,0,1-12,12H100a12,12,0,0,1-12-12V100a12,12,0,0,1,12-12h56A12,12,0,0,1,168,100Z"/>
      </svg>
      <span style="vertical-align:middle;">Stop Claude</span>
    `,e.style.cssText=`
      position: relative; transform: translateY(100px);
      padding: 10px 16px; background: #FAF9F5; color: #141413;
      border: 0.5px solid rgba(31,30,29,0.4); border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px; font-weight: 600; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 24px rgba(59,130,246,0.35);
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      opacity: 0; user-select: none; pointer-events: auto; white-space: nowrap;
    `,e.addEventListener("mouseenter",()=>{e.style.background="#F5F4F0"}),e.addEventListener("mouseleave",()=>{e.style.background="#FAF9F5"}),e.addEventListener("click",()=>{chrome.runtime.sendMessage({type:"STOP_AGENT",fromTabId:"CURRENT_TAB"})}),n.appendChild(e),document.body.appendChild(n)}n.style.display="",requestAnimationFrame(()=>{const e=n==null?void 0:n.querySelector("#claude-agent-stop-button");e&&(e.style.transform="translateY(0)",e.style.opacity="1")})}function S(){const e=n==null?void 0:n.querySelector("#claude-agent-stop-button");e&&(e.style.transform="translateY(100px)",e.style.opacity="0")}function h(e,p){if(!c)return Promise.resolve();if(!t){const i="http://www.w3.org/2000/svg",r=b=>{const d=document.createElementNS(i,"path");d.setAttribute("d","M0 0 L0 18 L4.5 14 L7.5 21.5 L11 20 L8 13 L14 13 Z");for(const[f,g]of Object.entries(b))d.setAttribute(f,g);return d},l=(b,d,f,g)=>{const a=document.createElementNS(i,"svg");return a.id=b,a.setAttribute("width","20"),a.setAttribute("height","26"),a.setAttribute("viewBox","0 0 20 26"),a.style.cssText=`position:absolute;top:0;left:0;overflow:visible;${g}`,a.appendChild(r({stroke:d,"stroke-width":"3","stroke-linejoin":"round",fill:d})),a.appendChild(r({fill:f})),a};t=document.createElement("div"),t.id="claude-phantom-cursor",t.setAttribute("aria-hidden","true"),t.style.cssText=`
      position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147483646;
      transform: translate3d(${e}px, ${p}px, 0);
      transition: transform 180ms cubic-bezier(0.2,0,0,1);
      will-change: transform;
    `,t.appendChild(l("claude-phantom-cursor-plain","white","#111",""));const u=y();return t.appendChild(l("claude-phantom-cursor-styled",u.hex,u.fill,`filter:drop-shadow(0 0 5px rgba(${u.rgb},1)) drop-shadow(0 0 12px rgba(${u.rgb},0.7)) drop-shadow(0 0 20px rgba(${u.rgb},0.4));`)),document.body.appendChild(t),Promise.resolve()}const o=t.querySelector("#claude-phantom-cursor-styled");if(o){const i=y();o.style.filter=`drop-shadow(0 0 5px rgba(${i.rgb},1)) drop-shadow(0 0 12px rgba(${i.rgb},0.7)) drop-shadow(0 0 20px rgba(${i.rgb},0.4))`;const r=o.querySelectorAll("path");r[0]&&(r[0].setAttribute("stroke",i.hex),r[0].setAttribute("fill",i.hex)),r[1]&&r[1].setAttribute("fill",i.fill)}return t.style.display="",t.style.transform=`translate3d(${e}px, ${p}px, 0)`,document.hidden?Promise.resolve():new Promise(i=>{let r=!1;const l=()=>{r||(r=!0,t==null||t.removeEventListener("transitionend",l),i())};t.addEventListener("transitionend",l,{once:!0}),setTimeout(l,220)})}function T(){t==null||t.remove(),t=null}function k(){c=!0,v(),A(),F(),t?t.style.display="":h(Math.round(window.innerWidth/2),Math.round(window.innerHeight/2))}function w(){c&&(c=!1,E(),S(),setTimeout(()=>{c||(s==null||s.remove(),s=null,n==null||n.remove(),n=null,T())},300))}chrome.runtime.onMessage.addListener((e,p,o)=>{switch(e.type){case"SHOW_AGENT_INDICATORS":m=!!e.bossMode,k(),o({success:!0});break;case"HIDE_AGENT_INDICATORS":w(),o({success:!0});break;case"UPDATE_PHANTOM_CURSOR":return h(e.x,e.y).then(()=>o({success:!0})),!0;case"HIDE_FOR_TOOL_USE":x=c,s&&(s.style.display="none"),n&&(n.style.display="none"),t&&(t.style.display="none"),o({success:!0});break;case"SHOW_AFTER_TOOL_USE":x&&(s&&(s.style.display=""),n&&(n.style.display="")),t&&(t.style.display=""),x=!1,o({success:!0});break}return!1});window.addEventListener("beforeunload",()=>{w()});
