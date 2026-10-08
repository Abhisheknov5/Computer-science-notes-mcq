/* =========================================================
   CS FINAL PUBLIC HIERARCHY
   Subject -> Main Topic -> Subtopic -> MCQ Sets
   Loaded after the existing app.js; quiz.js and old routes stay intact.
========================================================= */
(function(){
  const oldEscape=window.escapeHtml || (v=>String(v??''));
  const esc=oldEscape;
  const subjectMap={
    ai:{name:'Artificial Intelligence (AI)',icon:'🤖'},cn:{name:'Computer Networks (CN)',icon:'🌐'},
    dsa:{name:'Data Structures & Algorithms (DSA)',icon:'🧩'},dbms:{name:'Database Management System (DBMS)',icon:'🗄️'},
    de:{name:'Digital Electronics (DE)',icon:'🔌'},'e-commerce':{name:'E-Commerce',icon:'🛒'},
    iot:{name:'Internet of Things (IoT)',icon:'📡'},multimedia:{name:'Multimedia',icon:'🎞️'},
    oops:{name:'Object-Oriented Programming (OOPS)',icon:'💻'},os:{name:'Operating System (OS)',icon:'⚙️'},
    'software-engineering':{name:'Software Engineering',icon:'🛠️'},toc:{name:'Theory of Computation (TOC)',icon:'🧠'}
  };
  const appEl=()=>document.getElementById('app');
  const subjectInfo=id=>subjectMap[id]||{name:id,icon:'📚'};

  async function loadSubjects(){
    try{
      const r=await fetch('/api/cs/subjects',{cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const d=await r.json();
      const items=Array.isArray(d.items)?d.items:[];
      items.forEach(item=>{
        const id=String(item?.id||'').trim().toLowerCase();
        if(!id) return;
        subjectMap[id]={name:item.name||item.code||id,icon:item.icon||'📚'};
      });
      return items;
    }catch(e){
      console.warn('Dynamic subject list unavailable; using existing subjects.',e);
      return Object.entries(subjectMap).map(([id,v])=>({id,name:v.name,icon:v.icon,code:id}));
    }
  }

  function renderSubjects(items){
    const root=appEl(); if(!root)return;
    root.innerHTML=`
      <div class="page-header"><h1>💻 Computer Science</h1><p>Subject select karein</p></div>
      <div class="card-grid" id="csSubjectCards"></div>`;
    const grid=document.getElementById('csSubjectCards');
    if(!items.length){
      grid.innerHTML='<div class="card"><h2>Subjects अभी उपलब्ध नहीं</h2></div>';
      return;
    }
    items.forEach(item=>{
      const id=String(item?.id||'').trim().toLowerCase();
      if(!id)return;
      const card=document.createElement('div');
      card.className='card';
      card.innerHTML=`<div class="card-icon">${esc(item.icon||subjectInfo(id).icon||'📚')}</div><h3>${esc(item.name||subjectInfo(id).name||id)}</h3><p>${esc(item.code||id)}</p><button class="btn btn-blue" type="button">Open Subject</button>`;
      card.querySelector('button').onclick=()=>{location.hash=`subject/${encodeURIComponent(id)}`;};
      grid.appendChild(card);
    });
  }

  async function loadHierarchy(subjectId){
    const r=await fetch(`/api/cs/public-hierarchy-v2/${encodeURIComponent(subjectId)}`,{cache:'no-store'});
    const d=await r.json();
    if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);
    return Array.isArray(d.items)?d.items:[];
  }

  async function loadNotes(subjectId){
    try{const r=await fetch(`/api/cs/subject-notes/${encodeURIComponent(subjectId)}`,{cache:'no-store'});if(!r.ok)return null;const d=await r.json();return d?.success&&d?.exists?d.notesUrl:null;}catch{return null;}
  }

  function renderSubject(subjectId,items,notesUrl){
    const s=subjectInfo(subjectId);
    const root=appEl(); if(!root)return;
    root.innerHTML=`
      <button class="back-btn" onclick="location.hash='science'">← Back to Subjects</button>
      <div class="page-header"><h1>${s.icon} ${esc(s.name)}</h1><p>Topics, Notes and MCQ Practice</p></div>
      ${notesUrl?`<div style="display:flex;justify-content:center;margin:16px 0 20px"><button class="btn btn-blue" id="csNotesBtn">📖 ${esc(s.name)} Notes</button></div>`:''}
      <section class="chapter-list" id="csMainTopicList"></section>`;
    if(notesUrl) document.getElementById('csNotesBtn').onclick=()=>window.open(notesUrl,'_blank','noopener,noreferrer');
    const list=document.getElementById('csMainTopicList');
    if(!items.length){
      list.innerHTML=`<div class="card"><h2>Topics अभी उपलब्ध नहीं</h2><p>इस subject के Main Topics अभी add नहीं किए गए हैं।</p></div>`;return;
    }
    items.forEach((main,index)=>{
      const row=document.createElement('div'); row.className='chapter-item';
      row.innerHTML=`<div class="chapter-name"><strong>Topic ${index+1}</strong><span>${esc(main.title||'')}</span></div><div class="chapter-actions"><button class="btn btn-blue" type="button">⌄ Open</button></div>`;
      const btn=row.querySelector('button');
      const children=Array.isArray(main.subtopics)?main.subtopics:[];
      const childBox=document.createElement('div');
      childBox.style.cssText='display:none;margin:0 0 16px;padding:14px 18px 6px;background:#f5faf7;border:1px solid #e2eee5;border-top:0;border-radius:0 0 12px 12px;';
      if(!children.length){childBox.innerHTML='<div style="color:#667085;padding:8px 0">Subtopics अभी उपलब्ध नहीं</div>';}else{
        children.forEach((sub,si)=>{
          const sets=Array.isArray(sub.mcqSets)?sub.mcqSets:[];
          const item=document.createElement('div');
          item.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #e5e7eb;';
          item.innerHTML=`<div><div style="font-weight:600;color:#253047">${si+1}. ${esc(sub.title||'')}</div></div><div><button class="btn btn-green" type="button">📝 MCQ (${sets.length} Set${sets.length===1?'':'s'})</button></div>`;
          item.querySelector('button').onclick=()=>{ if(!sets.length){alert('Is Subtopic ke liye MCQ abhi available nahi hai.');return;} location.hash=`subtopic-mcq/${encodeURIComponent(subjectId)}/${encodeURIComponent(main.chapterNumber)}/${encodeURIComponent(sub.id)}/${encodeURIComponent(sub.title||'')}`; };
          childBox.appendChild(item);
        });
      }
      btn.onclick=()=>{const open=childBox.style.display!=='none';childBox.style.display=open?'none':'block';btn.textContent=open?'⌄ Open':'⌃ Close';};
      row.appendChild(childBox); list.appendChild(row);
    });
  }

  async function renderSubtopicMCQ(subjectId,chapterNumber,subtopicId,title){
    const s=subjectInfo(subjectId), root=appEl(); if(!root)return;
    root.innerHTML=`<button class="back-btn" onclick="location.hash='subject/${encodeURIComponent(subjectId)}'">← Back to Topics</button><div class="page-header"><h1>📝 MCQ Practice</h1><p>${esc(s.name)} — ${esc(title)}</p></div><div id="csSetLoading" class="card"><h2>Loading MCQ Sets...</h2><p>Please wait.</p></div>`;
    let items=[];
    try{const r=await fetch(`/api/cs/mcq-html/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterNumber)}?subtopicId=${encodeURIComponent(subtopicId)}`,{cache:'no-store'});if(r.ok){const d=await r.json();items=Array.isArray(d.items)?d.items:[];}}catch(e){console.error(e);}
    const loading=document.getElementById('csSetLoading');
    if(!items.length){loading.innerHTML='<h2>MCQ अभी उपलब्ध नहीं</h2><p>इस Subtopic के लिए अभी कोई MCQ Set upload नहीं किया गया है।</p>';return;}
    loading.remove();
    const grid=document.createElement('div');grid.className='card-grid';
    items.forEach((item,i)=>{const card=document.createElement('div');card.className='card';card.innerHTML=`<div class="card-icon">📝</div><h3>Set ${i+1}</h3><p>${esc(item.name||item.originalName||'MCQ Set')}</p><p><strong>${Number(item.questionCount||0)}</strong> Questions</p><button class="btn btn-green" type="button">▶ Start MCQ</button>`;card.querySelector('button').onclick=()=>{location.hash=`quiz/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterNumber)}/${encodeURIComponent(item.id)}/direct`;};grid.appendChild(card);});
    root.appendChild(grid);
  }

  async function hierarchyRouter(){
    const hash=window.location.hash||'#home'; const p=hash.substring(1).split('/');
    if(p[0]==='science'){
      const items=await loadSubjects();
      if((window.location.hash||'')==='#science') renderSubjects(items);
      return true;
    }
    if(p[0]==='subject'&&p[1]){
      try{const [items,notes]=await Promise.all([loadHierarchy(p[1]),loadNotes(p[1])]);if((window.location.hash||'').substring(1).split('/')[0]==='subject')renderSubject(p[1],items,notes);}catch(e){console.error('Hierarchy load error:',e);}
      return true;
    }
    if(p[0]==='subtopic-mcq'&&p[1]&&p[2]&&p[3]){
      renderSubtopicMCQ(decodeURIComponent(p[1]),Number(p[2]),decodeURIComponent(p[3]),decodeURIComponent(p[4]||''));return true;
    }
    return false;
  }
  // The legacy app.js also listens to DOMContentLoaded/hashchange.
  // Capture the CS hierarchy routes first so the legacy chapter renderer
  // cannot race with this final hierarchy renderer on the first open.
  const isHierarchyRoute=()=>{
    const p=(window.location.hash||'#home').substring(1).split('/');
    return p[0]==='science'||p[0]==='subject'||p[0]==='subtopic-mcq';
  };

  window.addEventListener('DOMContentLoaded',event=>{
    if(!isHierarchyRoute()) return;
    event.stopImmediatePropagation();
    hierarchyRouter();
  },true);

  window.addEventListener('hashchange',event=>{
    if(!isHierarchyRoute()) return;
    event.stopImmediatePropagation();
    hierarchyRouter();
  },true);

  setTimeout(()=>{
    if(isHierarchyRoute()) hierarchyRouter();
  },0);
})();
