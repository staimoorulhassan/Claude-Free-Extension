let i=null,n=null,t=null,l=!1,m=!1;function x(){if(document.getElementById("claude-agent-styles"))return;const e=document.createElement("style");e.id="claude-agent-styles",e.textContent=`
    @keyframes claude-pulse {
      0%   { box-shadow: inset 0 0 12px rgba(59,130,246,0.55), inset 0 0 24px rgba(59,130,246,0.35), inset 0 0 40px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.6); }
      50%  { box-shadow: inset 0 0 18px rgba(59,130,246,0.80), inset 0 0 32px rgba(59,130,246,0.55), inset 0 0 50px rgba(59,130,246,0.25), 0 0 0 2px rgba(59,130,246,0.9); }
      100% { box-shadow: inset 0 0 12px rgba(59,130,246,0.55), inset 0 0 24px rgba(59,130,246,0.35), inset 0 0 40px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.6); }
    }
  `,document.head.appendChild(e)}function g(){i||(i=document.createElement("div"),i.id="claude-agent-glow-border",i.style.cssText=`
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 2147483646;
      opacity: 0; transition: opacity 0.3s ease-in-out;
      animation: claude-pulse 2s ease-in-out infinite;
      box-shadow: inset 0 0 12px rgba(59,130,246,0.55), inset 0 0 24px rgba(59,130,246,0.35), inset 0 0 40px rgba(59,130,246,0.15), 0 0 0 2px rgba(59,130,246,0.6);
    `,document.body.appendChild(i)),i.style.display="",requestAnimationFrame(()=>{i&&(i.style.opacity="1")})}function h(){i&&(i.style.opacity="0")}function v(){if(!n){n=document.createElement("div"),n.id="claude-agent-stop-container",n.style.cssText=`
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
    `,e.addEventListener("mouseenter",()=>{e.style.background="#F5F4F0"}),e.addEventListener("mouseleave",()=>{e.style.background="#FAF9F5"}),e.addEventListener("click",()=>{chrome.runtime.sendMessage({type:"STOP_AGENT",fromTabId:"CURRENT_TAB"})}),n.appendChild(e),document.body.appendChild(n)}n.style.display="",requestAnimationFrame(()=>{const e=n==null?void 0:n.querySelector("#claude-agent-stop-button");e&&(e.style.transform="translateY(0)",e.style.opacity="1")})}function w(){const e=n==null?void 0:n.querySelector("#claude-agent-stop-button");e&&(e.style.transform="translateY(100px)",e.style.opacity="0")}function y(e,c){if(!l)return Promise.resolve();if(!t){const s="http://www.w3.org/2000/svg",d=u=>{const o=document.createElementNS(s,"path");o.setAttribute("d","M0 0 L0 18 L4.5 14 L7.5 21.5 L11 20 L8 13 L14 13 Z");for(const[p,f]of Object.entries(u))o.setAttribute(p,f);return o},a=(u,o,p,f)=>{const r=document.createElementNS(s,"svg");return r.id=u,r.setAttribute("width","20"),r.setAttribute("height","26"),r.setAttribute("viewBox","0 0 20 26"),r.style.cssText=`position:absolute;top:0;left:0;overflow:visible;${f}`,r.appendChild(d({stroke:o,"stroke-width":"3","stroke-linejoin":"round",fill:o})),r.appendChild(d({fill:p})),r};return t=document.createElement("div"),t.id="claude-phantom-cursor",t.setAttribute("aria-hidden","true"),t.style.cssText=`
      position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147483646;
      transform: translate3d(${e}px, ${c}px, 0);
      transition: transform 180ms cubic-bezier(0.2,0,0,1);
      will-change: transform;
    `,t.appendChild(a("claude-phantom-cursor-plain","white","#111","")),t.appendChild(a("claude-phantom-cursor-styled","#3B82F6","#EFF6FF","filter:drop-shadow(0 0 5px rgba(59,130,246,1)) drop-shadow(0 0 12px rgba(59,130,246,0.7)) drop-shadow(0 0 20px rgba(59,130,246,0.4));")),document.body.appendChild(t),Promise.resolve()}return t.style.display="",t.style.transform=`translate3d(${e}px, ${c}px, 0)`,document.hidden?Promise.resolve():new Promise(s=>{let d=!1;const a=()=>{d||(d=!0,t==null||t.removeEventListener("transitionend",a),s())};t.addEventListener("transitionend",a,{once:!0}),setTimeout(a,220)})}function A(){t==null||t.remove(),t=null}function E(){l=!0,x(),g(),v(),t?t.style.display="":y(Math.round(window.innerWidth/2),Math.round(window.innerHeight/2))}function b(){l&&(l=!1,h(),w(),setTimeout(()=>{l||(i==null||i.remove(),i=null,n==null||n.remove(),n=null,A())},300))}chrome.runtime.onMessage.addListener((e,c,s)=>{switch(e.type){case"SHOW_AGENT_INDICATORS":E(),s({success:!0});break;case"HIDE_AGENT_INDICATORS":b(),s({success:!0});break;case"UPDATE_PHANTOM_CURSOR":return y(e.x,e.y).then(()=>s({success:!0})),!0;case"HIDE_FOR_TOOL_USE":m=l,i&&(i.style.display="none"),n&&(n.style.display="none"),t&&(t.style.display="none"),s({success:!0});break;case"SHOW_AFTER_TOOL_USE":m&&(i&&(i.style.display=""),n&&(n.style.display="")),t&&(t.style.display=""),m=!1,s({success:!0});break}return!1});window.addEventListener("beforeunload",()=>{b()});
