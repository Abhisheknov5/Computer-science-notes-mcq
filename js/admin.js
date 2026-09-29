"use strict";

let currentSubject = "";
let currentChapter = null;
let currentMainTopic = null;
let currentSubtopic = null;
let csMainTopicsCache = [];
let csSubtopicsCache = [];
let importedQuestions = [];
let importedData = null;

const CHAPTER_CACHE_BUSTER_KEY = "csChapterList:buster";

const subjectIdMap = {
    "AI": "ai",
    "CN": "cn",
    "DSA": "dsa",
    "DBMS": "dbms",
    "DE": "de",
    "E-Commerce": "e-commerce",
    "IoT": "iot",
    "Multimedia": "multimedia",
    "OOPS": "oops",
    "OS": "os",
    "Software-Engineering": "software-engineering",
    "TOC": "toc"
};

const subjectNameMap = {
    "AI": "Artificial Intelligence (AI)",
    "CN": "Computer Networks (CN)",
    "DSA": "Data Structures & Algorithms (DSA)",
    "DBMS": "Database Management System (DBMS)",
    "DE": "Digital Electronics (DE)",
    "E-Commerce": "E-Commerce",
    "IoT": "Internet of Things (IoT)",
    "Multimedia": "Multimedia",
    "OOPS": "Object-Oriented Programming (OOPS)",
    "OS": "Operating System (OS)",
    "Software-Engineering": "Software Engineering",
    "TOC": "Theory of Computation (TOC)"
};

const mainTopicPlaceholderMap = {
    "AI": "Main Topic Title (e.g. Machine Learning, Expert Systems)",
    "CN": "Main Topic Title (e.g. OSI Model, Network Topology)",
    "DSA": "Main Topic Title (e.g. Arrays, Linked Lists)",
    "DBMS": "Main Topic Title (e.g. DBMS Tutorial, Data Modeling)",
    "DE": "Main Topic Title (e.g. Number Systems, Logic Gates)",
    "E-Commerce": "Main Topic Title (e.g. E-Commerce Models, Online Payment)",
    "IoT": "Main Topic Title (e.g. IoT Architecture, Sensors)",
    "Multimedia": "Main Topic Title (e.g. Multimedia Basics, Image Processing)",
    "OOPS": "Main Topic Title (e.g. Classes & Objects, Inheritance)",
    "OS": "Main Topic Title (e.g. Process Management, Memory Management)",
    "Software-Engineering": "Main Topic Title (e.g. SDLC, Software Testing)",
    "TOC": "Main Topic Title (e.g. Finite Automata, Regular Expressions)"
};

function updateMainTopicPlaceholder(){
    const input=getElementOptional("mainTopicTitle");
    if(!input) return;

    input.placeholder = currentSubject
        ? (mainTopicPlaceholderMap[currentSubject] || "Main Topic Title")
        : "Main Topic Title (select a subject first)";
}

function getElement(id) {
    const el=document.getElementById(id);
    if(!el) throw new Error(`HTML में "${id}" element नहीं मिला।`);
    return el;
}
function showMessage(id,text,type){const box=getElement(id);box.textContent=text;box.className="message "+type;box.style.display="block";}
function escapeHTML(value){return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function escapeJS(value){return String(value).replaceAll("\\","\\\\").replaceAll("'","\\'").replaceAll("\n","\\n").replaceAll("\r","\\r");}
function notifyChapterListChanged(){try{localStorage.setItem(CHAPTER_CACHE_BUSTER_KEY,String(Date.now()));}catch{}}

function getElementOptional(id){
    return document.getElementById(id);
}

function selectSubject(subject){
    resetSimpleWorkflow();
    currentSubject=subject;
    currentChapter=1;
    currentMainTopic=null;
    currentSubtopic=null;
    csMainTopicsCache=[];
    csSubtopicsCache=[];

    document.querySelectorAll(".subject-card").forEach(card=>{
        card.classList.toggle("active",card.dataset.subject===subject);
    });

    const subjectText=subjectNameMap[subject]||subject;

    const title=getElementOptional("currentSubjectTitle");
    if(title) title.textContent=subjectText;

    const badge=getElementOptional("selectionBadge");
    if(badge) badge.textContent=subjectText;

    const quizList=getElementOptional("quizList");
    if(quizList){
        quizList.innerHTML=`<div class="empty">Chapter select karke <strong>Load MCQ</strong> dabaiye.</div>`;
    }

    const mcqCount=getElementOptional("mcqCountBadge");
    if(mcqCount) mcqCount.textContent="0 MCQ Sets";

    // Main Topics are the first level inside a Subject.
    loadCSMainTopics(1);

    const notesUrl=getElementOptional("notesUrl");
    if(notesUrl) notesUrl.value="";

    const notesMessage=getElementOptional("notesMessage");
    if(notesMessage) notesMessage.style.display="none";

    updateMainTopicPlaceholder();
    updateSelectionUI();
}

/* HTML subject cards call this exact function name. */
window.selectSubjectCard=function(subject){
    selectSubject(subject);
};

window.selectSubject=selectSubject;

function updateSelectionUI(){
    // Chapter is an internal compatibility bucket only; users never manage it here.
    currentChapter=Number(currentChapter||1);

    const subjectText=currentSubject
        ? (subjectNameMap[currentSubject]||currentSubject)
        : "Select Subject";

    updateMainTopicPlaceholder();

    const chapterText="";

    const title=getElementOptional("currentSubjectTitle");
    if(title) title.textContent=subjectText;

    const badge=getElementOptional("selectionBadge");
    if(badge) badge.textContent=subjectText;

    const uploadSubject=getElementOptional("uploadSubjectText");
    if(uploadSubject) uploadSubject.textContent=currentSubject?subjectText:"—";

    const uploadChapter=getElementOptional("uploadChapterText");
    if(uploadChapter) uploadChapter.textContent=currentChapter||"—";

    const uploadMainTopic=getElementOptional("uploadMainTopicText");
    if(uploadMainTopic) uploadMainTopic.textContent=currentMainTopic?.title||"—";

    const uploadSubtopic=getElementOptional("uploadSubtopicText");
    if(uploadSubtopic) uploadSubtopic.textContent=currentSubtopic?.title||"—";

    const description=getElementOptional("listDescription");
    if(description){
        description.textContent=currentSubject&&currentChapter
            ? `${subjectText} • Topic ${currentChapter}`
            : "Selected subject ke uploaded MCQ yahan dikhenge.";
    }
}

const chapterNumberInput=null;
if(chapterNumberInput){
    chapterNumberInput.addEventListener("input",()=>{
        updateSelectionUI();
        const quizList=getElementOptional("quizList");
        if(quizList) quizList.innerHTML=`<div class="empty"><strong>Load MCQ</strong> dabaiye.</div>`;
        const mcqCount=getElementOptional("mcqCountBadge");
        if(mcqCount) mcqCount.textContent="0 MCQ Sets";
    });
}

const mcqFileInput=getElementOptional("mcqFile");
if(mcqFileInput){
    mcqFileInput.addEventListener("change",function(){
        const file=this.files[0];
        const name=getElementOptional("htmlFileName");
        const cancelButton=getElementOptional("cancelMCQFile");
        if(name) name.textContent=file?file.name:"No file selected";
        if(cancelButton) cancelButton.style.display=file?"inline-flex":"none";
    });
}

window.cancelMCQFile=function(){
    const fileInput=getElementOptional("mcqFile");
    const name=getElementOptional("htmlFileName");
    const cancelButton=getElementOptional("cancelMCQFile");

    if(fileInput) fileInput.value="";
    if(name) name.textContent="No file selected";
    if(cancelButton) cancelButton.style.display="none";
};

const jsonFileInput=getElementOptional("jsonFile");
if(jsonFileInput){
    jsonFileInput.addEventListener("change",function(){
        const file=this.files[0];
        const name=getElementOptional("fileName");
        if(!file){
            if(name) name.textContent="Koi JSON file select nahi ki gayi";
            return;
        }
        if(!file.name.toLowerCase().endsWith(".json")){
            this.value="";
            if(name) name.textContent="Koi JSON file select nahi ki gayi";
            alert("❌ केवल JSON file select करें।");
            return;
        }
        if(name) name.textContent=`Selected: ${file.name}`;
    });
}

async function checkLogin(){try{const r=await fetch("/api/owner/status");const d=await r.json();if(d&&d.authenticated){getElement("loginCard").classList.add("hidden");getElement("adminPanel").classList.remove("hidden");updateSelectionUI();}}catch(e){console.error(e);}}
async function login(){const password=getElement("password").value.trim();if(!password){showMessage("loginMessage","Password daaliye.","error");return;}try{const r=await fetch("/api/owner/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});const d=await r.json();if(!r.ok){showMessage("loginMessage",d.message||"Login failed.","error");return;}getElement("loginCard").classList.add("hidden");getElement("adminPanel").classList.remove("hidden");getElement("password").value="";updateSelectionUI();}catch{showMessage("loginMessage","Server se connection nahi ho raha.","error");}}
async function logout(){try{await fetch("/api/owner/logout",{method:"POST"});}catch{}getElement("adminPanel").classList.add("hidden");getElement("loginCard").classList.remove("hidden");}

function getManagementInputs(){
    if(!currentSubject||!subjectIdMap[currentSubject]) throw new Error("Pehle Subject select karein.");
    // Chapter is kept internally for backward compatibility; the admin UI does not expose it.
    const chapterNumber=Number(currentChapter||1);
    return {subject:subjectIdMap[currentSubject],chapterNumber};
}

async function saveChapter(){
    if(!currentSubject||!subjectIdMap[currentSubject]){
        alert("Pehle Subject select karein.");
        return;
    }

    const chapterTitle=getElement("chapterTitle").value.trim();
    if(!chapterTitle){
        alert("Topic Title daaliye.");
        return;
    }

    try{
        const r=await fetch("/api/cs/chapters",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
                subject:subjectIdMap[currentSubject],
                chapterTitle
            })
        });

        const d=await r.json();
        if(!r.ok||!d.success){
            alert(d.message||"Topic save nahi hua.");
            return;
        }

        currentChapter=Number(d.chapter?.number)||null;
        updateSelectionUI();

        showMessage(
            "chapterMessage",
            `✅ Topic ${currentChapter} successfully save ho gaya.`,
            "success"
        );

        getElement("chapterTitle").value="";
        notifyChapterListChanged();
    }catch(e){
        console.error(e);
        alert("Server error. Topic save nahi hua.");
    }
}
async function deleteChapter(){let inputs;try{inputs=getManagementInputs();}catch(e){alert(e.message);return;}if(!confirm(`Kya aap ${currentSubject} ka Topic ${inputs.chapterNumber} delete karna chahte hain?`))return;try{const r=await fetch("/api/cs/chapters",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify(inputs)});const d=await r.json();if(!r.ok||!d.success){alert(d.message||"Chapter delete nahi hua.");return;}showMessage("chapterMessage","✅ Topic delete ho gaya.","success");getElement("quizList").innerHTML=`<div class="empty">Topic ${inputs.chapterNumber} delete ho gaya.</div>`;getElement("mcqCountBadge").textContent="0 MCQ Sets";getElement("chapterTitle").value="";notifyChapterListChanged();}catch(e){console.error(e);alert("Server error. Chapter delete nahi hua.");}}

function getNotesInputs(){if(!currentSubject||!subjectIdMap[currentSubject])throw new Error("Pehle Subject select karein.");return {subject:subjectIdMap[currentSubject]};}
function openDriveForNotes(){window.open("https://drive.google.com/drive/my-drive","_blank","noopener,noreferrer");}
async function saveNotesLink(){let inputs;try{inputs=getNotesInputs();}catch(e){showMessage("notesMessage",e.message,"error");return;}const notesUrl=getElement("notesUrl").value.trim();if(!notesUrl){showMessage("notesMessage","Google Drive folder ka link paste karein.","error");return;}if(!/^https:\/\/(drive\.google\.com|docs\.google\.com)\//i.test(notesUrl)){showMessage("notesMessage","Valid Google Drive ya Google Docs link dijiye.","error");return;}try{const r=await fetch("/api/cs/subject-notes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...inputs,notesUrl})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.success){showMessage("notesMessage",d.message||`Notes save failed. HTTP ${r.status}`,"error");return;}showMessage("notesMessage",`✅ ${currentSubject} ka Notes folder link save ho gaya.` ,"success");notifyChapterListChanged();}catch(e){showMessage("notesMessage","Server se connection nahi ho raha.","error");}}
async function loadNotesLink(){let inputs;try{inputs=getNotesInputs();}catch(e){showMessage("notesMessage",e.message,"error");return;}try{const r=await fetch(`/api/cs/subject-notes/${inputs.subject}`,{cache:"no-store"});const d=await r.json();if(!r.ok||!d.success){showMessage("notesMessage",d.message||`Notes load failed. HTTP ${r.status}`,"error");return;}getElement("notesUrl").value=d.notesUrl||"";showMessage("notesMessage",d.exists?"✅ Saved Notes folder link load ho gaya.":"Is Subject ke liye Notes link saved nahi hai.",d.exists?"success":"error");}catch{showMessage("notesMessage","Notes API se connection nahi ho raha.","error");}}
async function deleteNotesLink(){let inputs;try{inputs=getNotesInputs();}catch(e){showMessage("notesMessage",e.message,"error");return;}if(!confirm(`Kya aap ${currentSubject} ka Notes folder link delete karna chahte hain?`))return;try{const r=await fetch("/api/cs/subject-notes",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify(inputs)});const d=await r.json();if(!r.ok||!d.success){showMessage("notesMessage",d.message||"Notes delete failed.","error");return;}getElement("notesUrl").value="";showMessage("notesMessage","✅ Notes folder link delete ho gaya.","success");notifyChapterListChanged();}catch{showMessage("notesMessage","Server se connection nahi ho raha.","error");}}

async function loadQuizzes(){
    const list=getElementOptional("quizList");
    const badge=getElementOptional("mcqCountBadge");
    if(!list) return;

    if(!currentSubject||!currentMainTopic||!currentSubtopic){
        list.innerHTML='<div class="empty">Pehle Subtopic select karein.</div>';
        if(badge) badge.textContent="0 MCQ Sets";
        return;
    }

    list.innerHTML='<div class="empty">Loading MCQ Sets...</div>';
    if(badge) badge.textContent="0 MCQ Sets";

    const subjectId=subjectIdMap[currentSubject];
    const chapterNumber=Number(currentChapter||1);
    try{
        const r=await fetch(`/api/cs/mcq-html/${encodeURIComponent(subjectId)}/${chapterNumber}?subtopicId=${encodeURIComponent(currentSubtopic.id)}`,{cache:"no-store"});
        const d=await r.json();
        if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);

        const items=Array.isArray(d.items)?d.items:[];
        if(badge) badge.textContent=`${items.length} MCQ Set${items.length===1?'':'s'}`;

        if(!items.length){
            list.innerHTML='<div class="empty">Is Subtopic ke andar abhi koi MCQ Set nahi hai. Neeche se HTML upload karein.</div>';
            return;
        }

        list.innerHTML='';
        items.forEach((item,index)=>{
            const row=document.createElement('div');
            row.className='quiz-item';
            row.innerHTML=`
                <div class="quiz-name"><strong>Set ${index+1}</strong><span>${escapeHTML(item.name||item.originalName||'MCQ Quiz')}</span></div>
                <div class="quiz-info">${Number(item.questionCount||0)} Questions</div>
                <div class="actions"></div>`;
            const actions=row.querySelector('.actions');

            const open=document.createElement('a');
            open.className='open-btn';
            open.href=item.url||'#';
            open.target='_blank';
            open.rel='noopener';
            open.textContent='▶ Open MCQ';
            actions.appendChild(open);

            const rename=document.createElement('button');
            rename.className='rename-btn';
            rename.textContent='✏ Rename';
            rename.onclick=()=>renameQuiz(subjectId,chapterNumber,item.id,item.name||item.originalName||'MCQ Quiz');
            actions.appendChild(rename);

            const del=document.createElement('button');
            del.className='delete-btn';
            del.textContent='🗑 Delete';
            del.onclick=()=>deleteQuizForTopic(subjectId,chapterNumber,item.id);
            actions.appendChild(del);

            list.appendChild(row);
        });
    }catch(error){
        console.error(error);
        list.innerHTML=`<div class="empty">Server error: ${escapeHTML(error.message)}</div>`;
        if(badge) badge.textContent="0 MCQ Sets";
    }
}

async function deleteQuizForTopic(subjectId,chapterNumber,id){
    if(!confirm("Kya aap is MCQ ko delete karna chahte hain?"))return;
    try{
        const r=await fetch("/api/cs/mcq-html",{
            method:"DELETE",
            headers:{"Content-Type":"application/json"},
            credentials:"same-origin",
            cache:"no-store",
            body:JSON.stringify({
                subject:subjectId,chapterNumber:Number(chapterNumber),id
            })
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.success){
            alert(d.message||`Delete failed. HTTP ${r.status}`);return;
        }
        notifyChapterListChanged();
        await loadQuizzes();
    }catch(e){
        console.error(e);
        alert(`Delete failed: ${e.message||"Server error."}`);
    }
}

async function uploadMCQ(){
    let inputs;
    try{inputs=getManagementInputs();}catch(e){
        showMessage("uploadMessage",e.message,"error");return;
    }
    if(!currentMainTopic){
        showMessage("uploadMessage","Main Topic open karke Subtopics manage karein.","error");
        return;
    }
    if(!currentSubtopic){
        showMessage("uploadMessage","Pehle Subtopic select karein.","error");
        return;
    }

    const file=getElement("mcqFile").files[0];
    if(!file){showMessage("uploadMessage","Pehle HTML file select karo.","error");return;}
    if(!/\.html?$/i.test(String(file.name||""))){
        showMessage("uploadMessage","Sirf HTML file upload karo.","error");return;
    }

    const fd=new FormData();
    fd.append("mcqFile",file,file.name);
    fd.append("subject",String(inputs.subject));
    fd.append("chapterNumber",String(inputs.chapterNumber));

    if(currentMainTopic?.id){
        fd.append("mainTopicId",String(currentMainTopic.id));
    }
    if(currentSubtopic?.id){
        fd.append("subtopicId",String(currentSubtopic.id));
    }

    try{
        showMessage("uploadMessage","⏳ Uploading MCQ HTML...","success");
        const r=await fetch("/api/cs/mcq-html/upload-v2",{
            method:"POST",body:fd,credentials:"same-origin",cache:"no-store"
        });
        const text=await r.text();
        let d={};
        try{d=text?JSON.parse(text):{};}catch{
            showMessage("uploadMessage",`❌ Upload failed (HTTP ${r.status}).`,"error");return;
        }
        if(!r.ok||!d.success){
            showMessage("uploadMessage",`❌ ${d.message||`Upload failed (HTTP ${r.status}).`}`,"error");return;
        }
        const count=Number(d.item?.questionCount||0);
        showMessage("uploadMessage",`✅ MCQ successfully upload ho gaya. ${count} MCQs detected.`,"success");
        getElement("mcqFile").value="";
        getElement("htmlFileName").textContent="No file selected";
        const c=getElementOptional("cancelMCQFile");
        if(c)c.style.display="none";
        notifyChapterListChanged();
        await loadQuizzes();
    }catch(e){
        console.error(e);
        showMessage("uploadMessage",`❌ Upload nahi hua: ${e.message||"Server error."}`,"error");
    }
}
async function renameQuiz(subjectId,chapterNumber,id,oldName){
    const newName=prompt("Naya quiz name daaliye:",oldName);
    if(!newName||!newName.trim())return;
    try{
        const r=await fetch("/api/cs/mcq-html/rename",{
            method:"PATCH",
            headers:{"Content-Type":"application/json"},
            credentials:"same-origin",
            cache:"no-store",
            body:JSON.stringify({
                subject:subjectId,chapterNumber:Number(chapterNumber),
                id,newName:newName.trim()
            })
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.success){
            alert(d.message||`Rename failed. HTTP ${r.status}`);return;
        }
        notifyChapterListChanged();
        await loadQuizzes();
    }catch(e){
        console.error(e);
        alert(`Rename failed: ${e.message||"Server error."}`);
    }
}
async function deleteQuiz(id){let inputs;try{inputs=getManagementInputs();}catch(e){alert(e.message);return;}if(!confirm("Kya aap is MCQ ko delete karna chahte hain?"))return;try{const r=await fetch("/api/cs/mcq-html",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({...inputs,id})});const d=await r.json();if(!r.ok||!d.success){alert(d.message||"Delete failed.");return;}notifyChapterListChanged();loadQuizzes();}catch{alert("Server error.");}}

/* ======================================================
   JSON IMPORTER
====================================================== */

function readJSONFile(file) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();

        reader.onload = function () {
            try {
                const text = String(reader.result || "").trim();

                if (!text) {
                    throw new Error("JSON file खाली है।");
                }

                resolve(JSON.parse(text));
            } catch (error) {
                reject(
                    new Error(
                        `JSON parse नहीं हो सका: ${error.message}`
                    )
                );
            }
        };

        reader.onerror = function () {
            reject(new Error("JSON file read नहीं हो सकी।"));
        };

        reader.readAsText(file);
    });
}

function getSection(number) {
    if (number >= 1 && number <= 35) return "A";
    if (number >= 36 && number <= 70) return "B";
    if (number >= 71 && number <= 105) return "C";
    if (number >= 106 && number <= 125) return "D";
    if (number >= 126) return "E";
    return "";
}

function getInputs() {
    if (!currentSubject || !subjectIdMap[currentSubject]) throw new Error("Pehle Subject select karein.");
    const chapterNumber = Number(getElement("chapterNumber").value);
    const chapterTitle = getElement("chapterTitle").value.trim();
    const jsonFile = getElement("jsonFile").files[0];
    if (!chapterNumber || chapterNumber < 1) throw new Error("Chapter Number invalid hai.");
    if (!chapterTitle) throw new Error("Chapter Title डालें।");
    if (!jsonFile) throw new Error("पहले MCQ JSON file upload करें।");
    if (!jsonFile.name.toLowerCase().endsWith(".json")) throw new Error("केवल JSON file upload करें।");
    return {subject: subjectIdMap[currentSubject], chapterNumber, chapterTitle, jsonFile};
}

function cleanQuestion(question, index) {
    const number = index + 1;

    if (!question || typeof question !== "object") {
        throw new Error(`Question ${number} invalid है।`);
    }

    const q = String(
        question.q ||
        question.question ||
        ""
    ).trim();

    if (!q) {
        throw new Error(
            `Question ${number} का question text missing है।`
        );
    }

    if (!Array.isArray(question.options)) {
        throw new Error(
            `Question ${number} के options missing हैं।`
        );
    }

    if (question.options.length !== 5) {
        throw new Error(
            `Question ${number} में exactly 5 options होने चाहिए। Received: ${question.options.length}`
        );
    }

    const options = question.options.map(function (option) {
        return String(option);
    });

    if (options.some(function (option) {
        return !option.trim();
    })) {
        throw new Error(
            `Question ${number} में empty option है।`
        );
    }

    let answer = question.answer;

    if (typeof answer === "string") {
        const answerText = answer.trim();

        if (/^[0-4]$/.test(answerText)) {
            answer = Number(answerText);
        } else if (/^[A-Ea-e]$/.test(answerText)) {
            answer =
                answerText.toUpperCase().charCodeAt(0) - 65;
        } else {
            const foundIndex = options.findIndex(function (option) {
                return option.trim().toLowerCase() ===
                    answerText.toLowerCase();
            });

            if (foundIndex === -1) {
                throw new Error(
                    `Question ${number} का answer invalid है।`
                );
            }

            answer = foundIndex;
        }
    }

    answer = Number(answer);

    if (
        !Number.isInteger(answer) ||
        answer < 0 ||
        answer > 4
    ) {
        throw new Error(
            `Question ${number} का answer 0 से 4 के बीच होना चाहिए।`
        );
    }

    const explanation = String(question.explanation || "");

    const originalId = Number(question.id);

    const id =
        Number.isInteger(originalId) && originalId > 0
            ? originalId
            : number;

    return {
        id,
        section: question.section || getSection(number),
        q,
        options,
        answer,
        explanation
    };
}

function extractQuestions(data) {
    if (Array.isArray(data)) return data;

    if (data && Array.isArray(data.questions)) {
        return data.questions;
    }

    if (data && Array.isArray(data.mcqs)) {
        return data.mcqs;
    }

    if (
        data &&
        data.data &&
        Array.isArray(data.data.questions)
    ) {
        return data.data.questions;
    }

    throw new Error(
        "JSON में questions array नहीं मिला।"
    );
}

function validateQuestions(questions) {
    if (!Array.isArray(questions)) {
        throw new Error("Questions array invalid है।");
    }

    return questions.map(function (question, index) {
        return cleanQuestion(question, index);
    });
}

function createOutputData(inputs, questions) {
    return {
        chapterTitle: inputs.chapterTitle,
        subject: inputs.subject,
        chapterNumber: inputs.chapterNumber,
        title: inputs.chapterTitle,
        chapter: inputs.chapterNumber,
        totalQuestions: questions.length,
        generatedAt: new Date().toISOString(),
        questions
    };
}

function getSectionCounts(questions) {
    const counts = { A: 0, B: 0, C: 0, D: 0, E: 0 };

    questions.forEach(function (question) {
        if (Object.prototype.hasOwnProperty.call(counts, question.section)) {
            counts[question.section]++;
        }
    });

    return counts;
}

function showSummary(questions) {
    const counts = getSectionCounts(questions);

    getElement("summary").innerHTML = `
        <div class="status-row">
            <strong>✅ MCQs Validated</strong>
            <br><br>
            Section A: ${counts.A}
            &nbsp; | &nbsp;
            Section B: ${counts.B}
            &nbsp; | &nbsp;
            Section C: ${counts.C}
            &nbsp; | &nbsp;
            Section D: ${counts.D}
            &nbsp; | &nbsp;
            Section E: ${counts.E}
        </div>
    `;

    getElement("sectionStatus").innerHTML = `
        <div class="status-row">
            A: ${counts.A}
            &nbsp; | &nbsp;
            B: ${counts.B}
            &nbsp; | &nbsp;
            C: ${counts.C}
            &nbsp; | &nbsp;
            D: ${counts.D}
            &nbsp; | &nbsp;
            E: ${counts.E}
        </div>
    `;
}

async function importMCQs() {
    const importBtn = getElement("importBtn");

    try {
        const inputs = getInputs();

        importBtn.disabled = true;
        importBtn.textContent = "⏳ Importing...";

        getElement("previewCard").classList.add("hidden");
        getElement("resultCard").classList.add("hidden");
        getElement("progressCard").classList.remove("hidden");

        getElement("progressBar").style.width = "10%";
        getElement("progressText").textContent =
            "📄 JSON file पढ़ी जा रही है...";
        getElement("sectionStatus").innerHTML = "";

        const data = await readJSONFile(inputs.jsonFile);

        getElement("progressBar").style.width = "35%";
        getElement("progressText").textContent =
            "🔍 Questions data निकाला जा रहा है...";

        const rawQuestions = extractQuestions(data);

        getElement("progressBar").style.width = "55%";
        getElement("progressText").textContent =
            `${rawQuestions.length} MCQs मिले। Validation चल रहा है...`;

        const questions = validateQuestions(rawQuestions);

        getElement("progressBar").style.width = "75%";
        getElement("progressText").textContent =
            "✅ सभी ${questions.length} MCQs validate हो गए।";

        importedData = createOutputData(
            inputs,
            questions
        );

        importedQuestions = questions;

        showSummary(questions);

        getElement("jsonPreview").value =
            JSON.stringify(importedData, null, 2);

        getElement("questionCount").textContent =
            `${questions.length} questions`;

        getElement("progressBar").style.width = "100%";
        getElement("progressText").textContent =
            "🎉 ${questions.length} MCQs successfully imported!";

        getElement("previewCard").classList.remove("hidden");
        getElement("previewCard").scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    } catch (error) {
        console.error("Import Error:", error);

        getElement("progressCard").classList.remove("hidden");
        getElement("progressBar").style.width = "100%";
        getElement("progressText").textContent =
            `❌ ${error.message}`;

        alert(`❌ Import Error\n\n${error.message}`);
    } finally {
        importBtn.disabled = false;
        importBtn.textContent = "📥 Import JSON";
    }
}

/* ======================================================
   SAVE JSON PERMANENTLY
====================================================== */

async function savePermanently() {
    const saveQuizBtn = getElement("saveQuizBtn");

    try {
        if (!importedData) {
            throw new Error("पहले MCQs import करें।");
        }

        if (
            !Array.isArray(importedData.questions) ||
            importedData.questions.length !== 150
        ) {
            throw new Error("Exactly 150 MCQs required हैं।");
        }

        saveQuizBtn.disabled = true;
        saveQuizBtn.textContent = "⏳ Saving...";

        getElement("progressCard").classList.remove("hidden");
        getElement("progressBar").style.width = "25%";
        getElement("progressText").textContent =
            "💾 MCQs server पर भेजे जा रहे हैं...";

        const response = await fetch(
            "/api/cs/save-mcqs",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(importedData)
            }
        );

        getElement("progressBar").style.width = "60%";

        const responseText = await response.text();

        let result;

        try {
            result = JSON.parse(responseText);
        } catch {
            throw new Error(
                `Server ने invalid response दिया। HTTP ${response.status}`
            );
        }

        if (!response.ok || !result.success) {
            throw new Error(
                result.message ||
                `Server Error: ${response.status}`
            );
        }

        getElement("progressBar").style.width = "100%";
        getElement("progressText").textContent =
            "✅ ${importedData.questions.length} MCQs permanently save हो गए!";

        getElement("resultCard").classList.remove("hidden");

        notifyChapterListChanged();

        getElement("resultText").innerHTML = `
            <div class="status-row">
                <strong>✅ ${importedData.questions.length} MCQs Saved Successfully</strong>
                <br><br>
                📁 File:
                ${escapeHTML(
                    result.fileName ||
                    `chapter-${String(importedData.chapterNumber).padStart(2, "0")}.json`
                )}
                <br><br>
                📖 Subject: ${escapeHTML(importedData.subject)}
                <br>
                📑 Chapter: ${importedData.chapterNumber}
                <br><br>
                <strong>🚀 Quiz start किया जा रहा है...</strong>
            </div>
        `;

        const subjectId = subjectIdMap[importedData.subject];

        if (!subjectId) {
            throw new Error(
                `Subject "${importedData.subject}" का Quiz ID नहीं मिला।`
            );
        }

        /*
         * Existing quiz route preserved.
         * No quiz.js/app.js change is required here.
         */
        const quizUrl =
            `/#quiz/${subjectId}/${importedData.chapterNumber}/json/direct`;

        setTimeout(function () {
            window.location.href = quizUrl;
        }, 1200);
    } catch (error) {
        console.error("Save Error:", error);

        getElement("progressBar").style.width = "100%";
        getElement("progressText").textContent =
            `❌ ${error.message}`;

        alert(`❌ Save Error\n\n${error.message}`);
    } finally {
        saveQuizBtn.disabled = false;
        saveQuizBtn.textContent =
            "💾 Save Permanently & Start Quiz";
    }
}

const saveQuizButton=getElementOptional("saveQuizBtn");
if(saveQuizButton){
    saveQuizButton.addEventListener("click",savePermanently);
}

/* ======================================================
   COPY JSON
====================================================== */

/* ======================================================
   DOWNLOAD JSON
====================================================== */

const importButton=getElementOptional("importBtn");
if(importButton) importButton.addEventListener("click",importMCQs);

if(saveQuizButton) saveQuizButton.addEventListener("click",savePermanently);

const copyButton=getElementOptional("copyBtn");
if(copyButton) copyButton.addEventListener("click",async function(){
    const text=getElement("jsonPreview").value.trim();
    if(!text){alert("पहले MCQs import करें।");return;}
    try{
        await navigator.clipboard.writeText(text);
        this.textContent="✓ Copied";
        setTimeout(()=>this.textContent="📋 Copy JSON",1500);
    }catch{
        getElement("jsonPreview").select();
        document.execCommand("copy");
        alert("JSON copied.");
    }
});

const downloadButton=getElementOptional("downloadBtn");
if(downloadButton) downloadButton.addEventListener("click",function(){
    const text=getElement("jsonPreview").value.trim();
    if(!text){alert("पहले MCQs import करें।");return;}
    let data;
    try{data=JSON.parse(text);}
    catch{alert("JSON invalid है।");return;}
    const chapterNumber=Number(data.chapterNumber||data.chapter);
    const filename=`chapter-${String(chapterNumber).padStart(2,"0")}.json`;
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download=filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
});

updateSelectionUI();
checkLogin();
console.log("Computer Science Admin — One Page Loaded");


// ============================================================
// CS HIERARCHY MANAGEMENT
// Course/Chapter -> Main Topic -> Subtopic -> MCQ
// ============================================================

function resetHierarchySelection(){
    currentMainTopic=null;
    currentSubtopic=null;
    csMainTopicsCache=[];
    csSubtopicsCache=[];

    const mainBadge=getElementOptional("selectedMainTopicTitle");
    if(mainBadge) mainBadge.textContent="No Main Topic Selected";

    const subBadge=getElementOptional("selectedSubtopicTitle");
    if(subBadge) subBadge.textContent="No Subtopic Selected";

    const subList=getElementOptional("subtopicList");
    if(subList) subList.innerHTML='<div class="cs-subtopic-empty">Pehle Main Topic open karein.</div>';

    updateSelectionUI();
}

async function loadCSMainTopics(chapterNumber=currentChapter||1){
    if(!currentSubject||!chapterNumber){
        csMainTopicsCache=[];
        renderCSMainTopics();
        return [];
    }

    try{
        const subject=subjectIdMap[currentSubject];
        const r=await fetch(`/api/cs/main-topics/${encodeURIComponent(subject)}/${encodeURIComponent(chapterNumber)}`,{cache:"no-store"});
        const d=await r.json();
        if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);

        csMainTopicsCache=Array.isArray(d.items)?d.items:[];
        resetSimpleWorkflow();
        renderCSMainTopics();
        return csMainTopicsCache;
    }catch(error){
        console.error(error);
        csMainTopicsCache=[];
        renderCSMainTopics();
        return [];
    }
}

function renderCSMainTopics(){
    const container=getElementOptional("mainTopicList");
    if(!container) return;

    if(!csMainTopicsCache.length){
        container.innerHTML='<div class="cs-subtopic-empty">Is Subject ke andar abhi koi Main Topic nahi hai.</div>';
        return;
    }

    container.innerHTML=csMainTopicsCache.map((item,index)=>`
        <div class="hierarchy-row">
            <div class="hierarchy-title">
                <span class="topic-number">${index+1}</span>
                <strong>${escapeHTML(item.title||"")}</strong>
            </div>
            <div class="hierarchy-actions">
                <button type="button" class="open-btn" onclick="manageCSMainTopic('${escapeJS(item.id||"")}')">📂 Open</button>
                <button type="button" class="rename-btn" onclick="renameCSMainTopic('${escapeJS(item.id||"")}')">✏ Rename</button>
                <button type="button" class="delete-btn" onclick="deleteCSMainTopic('${escapeJS(item.id||"")}')">🗑 Delete</button>
            </div>
        </div>`).join("");
}


function setWorkflowCard(id,show){
    const el=getElementOptional(id);
    if(el) el.hidden=!show;
}

function resetSimpleWorkflow(){
    setWorkflowCard("subtopicCard",false);
    setWorkflowCard("mcqCard",false);
    setWorkflowCard("uploadCard",false);
}

function manageCSMainTopic(id){
    currentMainTopic=csMainTopicsCache.find(x=>String(x.id)===String(id))||null;
    currentSubtopic=null;

    const badge=getElementOptional("selectedMainTopicTitle");
    if(badge) badge.textContent=currentMainTopic?.title||"No Main Topic Selected";

    setWorkflowCard("subtopicCard",!!currentMainTopic);
    setWorkflowCard("mcqCard",false);
    setWorkflowCard("uploadCard",false);

    const input=getElementOptional("subtopicTitle");
    if(input) input.value="";

    updateSelectionUI();
    loadCSSubtopics(currentMainTopic?.id);
    document.getElementById("subtopicCard")?.scrollIntoView({behavior:"smooth",block:"start"});
}

function manageCSSubtopic(id){
    currentSubtopic=csSubtopicsCache.find(x=>String(x.id)===String(id))||null;
    if(!currentSubtopic) return;

    const badge=getElementOptional("selectedSubtopicTitle");
    if(badge) badge.textContent=currentSubtopic.title||"No Subtopic Selected";

    setWorkflowCard("mcqCard",true);
    setWorkflowCard("uploadCard",true);
    updateSelectionUI();
    loadQuizzes();
    document.getElementById("mcqCard")?.scrollIntoView({behavior:"smooth",block:"start"});
}

function selectCSMainTopic(id){
    manageCSMainTopic(id);
    return;
    currentMainTopic=csMainTopicsCache.find(x=>String(x.id)===String(id))||null;
    currentSubtopic=null;

    const badge=getElementOptional("selectedMainTopicTitle");
    if(badge) badge.textContent=currentMainTopic?.title||"No Main Topic Selected";

    const hidden=getElementOptional("selectedMainTopicId");
    if(hidden) hidden.value=currentMainTopic?.id||"";

    const input=getElementOptional("mainTopicTitle");
    if(input) input.value=currentMainTopic?.title||"";

    const subBadge=getElementOptional("selectedSubtopicTitle");
    if(subBadge) subBadge.textContent="No Subtopic Selected";

    updateSelectionUI();
    loadCSSubtopics(currentMainTopic?.id);
    loadQuizzes();
}

async function saveCSMainTopic(){
    if(!currentSubject||!currentChapter){
        showMessage("mainTopicMessage","Pehle Subject select karein.","error");
        return;
    }

    const input=getElementOptional("mainTopicTitle");
    const title=String(input?.value||"").trim();
    if(!title){
        showMessage("mainTopicMessage","Main Topic Title daaliye.","error");
        input?.focus();
        return;
    }

    try{
        const r=await fetch("/api/cs/main-topics",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
                subject:subjectIdMap[currentSubject],
                chapterNumber:Number(currentChapter),
                title
            })
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);

        await loadCSMainTopics(currentChapter);
        currentMainTopic=null;
        currentSubtopic=null;
        resetSimpleWorkflow();
        if(input) input.value="";

        showMessage("mainTopicMessage",`✅ "${d.item?.title||title}" Main Topic save ho gaya.`,"success");

        if(Number(d.migratedLegacySubtopics||0)>0){
            showMessage("subtopicMessage",`✅ ${d.migratedLegacySubtopics} old Subtopics first Main Topic se link ho gaye.`,"success");
        }
    }catch(error){
        showMessage("mainTopicMessage",error.message||"Main Topic save nahi hua.","error");
    }
}

async function renameCSMainTopic(id){
    const item=csMainTopicsCache.find(x=>String(x.id)===String(id));
    if(!item) return;

    const value=window.prompt("Naya Main Topic name:",item.title||"");
    if(value===null) return;
    const newTitle=value.trim();
    if(!newTitle) return;

    try{
        const r=await fetch("/api/cs/main-topics/rename",{
            method:"PATCH",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
                subject:subjectIdMap[currentSubject],
                chapterNumber:Number(currentChapter),
                id:item.id,
                newTitle
            })
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);

        await loadCSMainTopics(currentChapter);
        if(currentMainTopic&&String(currentMainTopic.id)===String(id)) selectCSMainTopic(id);
        showMessage("mainTopicMessage","Main Topic rename ho gaya.","success");
    }catch(error){
        showMessage("mainTopicMessage",error.message||"Rename failed.","error");
    }
}

async function deleteCSMainTopic(id){
    const item=csMainTopicsCache.find(x=>String(x.id)===String(id));
    if(!item) return;

    if(!confirm(`"${item.title}" Main Topic delete karna hai?\n\nSubtopics registry se delete honge. Existing MCQ files delete nahi honge.`)) return;

    try{
        const r=await fetch("/api/cs/main-topics",{
            method:"DELETE",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
                subject:subjectIdMap[currentSubject],
                chapterNumber:Number(currentChapter),
                id:item.id
            })
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);

        if(currentMainTopic&&String(currentMainTopic.id)===String(id)){
            currentMainTopic=null;
            currentSubtopic=null;
        }

        await loadCSMainTopics(currentChapter);
        resetSimpleWorkflow();
        renderCSSubtopics();
        loadQuizzes();
        showMessage("mainTopicMessage","Main Topic delete ho gaya.","success");
    }catch(error){
        showMessage("mainTopicMessage",error.message||"Delete failed.","error");
    }
}

async function loadCSSubtopics(mainTopicId=currentMainTopic?.id){
    const container=getElementOptional("subtopicList");

    if(!currentSubject||!currentChapter||!mainTopicId){
        csSubtopicsCache=[];
        if(container) container.innerHTML='<div class="cs-subtopic-empty">Pehle Main Topic select karein.</div>';
        return [];
    }

    try{
        const subject=subjectIdMap[currentSubject];
        const r=await fetch(`/api/cs/subtopics-v2/${encodeURIComponent(subject)}/${encodeURIComponent(currentChapter)}?mainTopicId=${encodeURIComponent(mainTopicId)}`,{cache:"no-store"});
        const d=await r.json();
        if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);

        csSubtopicsCache=Array.isArray(d.items)?d.items:[];
        renderCSSubtopics();
        return csSubtopicsCache;
    }catch(error){
        console.error(error);
        csSubtopicsCache=[];
        renderCSSubtopics();
        return [];
    }
}

function renderCSSubtopics(){
    const container=getElementOptional("subtopicList");
    if(!container) return;

    if(!currentMainTopic){
        container.innerHTML='<div class="cs-subtopic-empty">Pehle Main Topic select karein.</div>';
        return;
    }

    if(!csSubtopicsCache.length){
        container.innerHTML=`<div class="cs-subtopic-empty">"${escapeHTML(currentMainTopic.title)}" ke andar abhi koi Subtopic nahi hai.</div>`;
        return;
    }

    container.innerHTML=csSubtopicsCache.map((item,index)=>`
        <div class="hierarchy-row">
            <div class="hierarchy-title">
                <span class="topic-number">${index+1}</span>
                <strong>${escapeHTML(item.title||"")}</strong>
            </div>
            <div class="hierarchy-actions">
                <button type="button" class="open-btn" onclick="manageCSSubtopic('${escapeJS(item.id||"")}')">📋 MCQ</button>
                <button type="button" class="rename-btn" onclick="renameCSSubtopic('${escapeJS(item.id||"")}')">✏ Rename</button>
                <button type="button" class="delete-btn" onclick="deleteCSSubtopic('${escapeJS(item.id||"")}')">🗑 Delete</button>
            </div>
        </div>`).join("");
}

function selectCSSubtopic(id){
    manageCSSubtopic(id);
    return;
    currentSubtopic=csSubtopicsCache.find(x=>String(x.id)===String(id))||null;

    const badge=getElementOptional("selectedSubtopicTitle");
    if(badge) badge.textContent=currentSubtopic?.title||"No Subtopic Selected";

    const hidden=getElementOptional("selectedSubtopicId");
    if(hidden) hidden.value=currentSubtopic?.id||"";

    const input=getElementOptional("subtopicTitle");
    if(input) input.value=currentSubtopic?.title||"";

    updateSelectionUI();
    loadQuizzes();
}

async function saveCSSubtopic(){
    if(!currentSubject||!currentChapter){
        showMessage("subtopicMessage","Pehle Subject select karein.","error");
        return;
    }

    if(!currentMainTopic){
        showMessage("subtopicMessage","Pehle Main Topic select karein.","error");
        return;
    }

    const input=getElementOptional("subtopicTitle");
    const title=String(input?.value||"").trim();
    if(!title){
        showMessage("subtopicMessage","Subtopic Title daaliye.","error");
        input?.focus();
        return;
    }

    try{
        const r=await fetch("/api/cs/subtopics-v2",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
                subject:subjectIdMap[currentSubject],
                chapterNumber:Number(currentChapter),
                mainTopicId:currentMainTopic.id,
                title
            })
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);

        if(input) input.value="";
        await loadCSSubtopics(currentMainTopic.id);
        showMessage("subtopicMessage","✅ Subtopic save ho gaya.","success");
    }catch(error){
        showMessage("subtopicMessage",error.message||"Subtopic save nahi hua.","error");
    }
}

async function renameCSSubtopic(id){
    const item=csSubtopicsCache.find(x=>String(x.id)===String(id));
    if(!item) return;

    const value=window.prompt("Naya Subtopic name:",item.title||"");
    if(value===null) return;
    const newTitle=value.trim();
    if(!newTitle) return;

    try{
        const r=await fetch("/api/cs/subtopics-v2/rename",{
            method:"PATCH",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
                subject:subjectIdMap[currentSubject],
                chapterNumber:Number(currentChapter),
                mainTopicId:currentMainTopic?.id||item.mainTopicId||"",
                id:item.id,
                newTitle
            })
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);

        await loadCSSubtopics(currentMainTopic?.id);
        if(currentSubtopic&&String(currentSubtopic.id)===String(id)) selectCSSubtopic(id);
        showMessage("subtopicMessage","Subtopic rename ho gaya.","success");
    }catch(error){
        showMessage("subtopicMessage",error.message||"Rename failed.","error");
    }
}

async function deleteCSSubtopic(id){
    const item=csSubtopicsCache.find(x=>String(x.id)===String(id));
    if(!item) return;

    if(!confirm(`"${item.title}" Subtopic delete karna hai?\n\nExisting MCQ files delete nahi honge.`)) return;

    try{
        const r=await fetch("/api/cs/subtopics-v2",{
            method:"DELETE",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
                subject:subjectIdMap[currentSubject],
                chapterNumber:Number(currentChapter),
                mainTopicId:currentMainTopic?.id||item.mainTopicId||"",
                id:item.id
            })
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.success) throw new Error(d.message||`HTTP ${r.status}`);

        if(currentSubtopic&&String(currentSubtopic.id)===String(id)) currentSubtopic=null;

        await loadCSSubtopics(currentMainTopic?.id);
        loadQuizzes();
        showMessage("subtopicMessage","Subtopic delete ho gaya.","success");
    }catch(error){
        showMessage("subtopicMessage",error.message||"Delete failed.","error");
    }
}





/* =========================================================
   ADMIN SUBJECT MANAGEMENT
   - Add Subject works from the existing Add New Subject panel.
   - Delete works for built-in + custom cards with exact-name confirmation.
   - Uses browser-local storage only; server.js is intentionally untouched.
========================================================= */
(function(){
    const DELETED_KEY = "csAdminDeletedSubjects";
    const CUSTOM_KEY = "csAdminCustomSubjects";

    function readJSON(key, fallback){
        try{
            const value=JSON.parse(localStorage.getItem(key)||"");
            return Array.isArray(value) ? value : fallback;
        }catch{return fallback;}
    }
    function writeJSON(key,value){
        try{localStorage.setItem(key,JSON.stringify(value));}catch{}
    }
    function slug(value){
        return String(value||"").trim().toLowerCase()
            .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
    }
    function esc(value){
        return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;")
            .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
    }
    function getGrid(){return document.querySelector(".cs-subject-grid");}
    function getMessage(){return document.getElementById("subjectManageMessage");}
    function message(text,type="success"){
        const el=getMessage();
        if(!el)return;
        el.textContent=text;
        el.className="message "+type;
        el.style.display="block";
    }
    function closePanel(){
        const p=document.getElementById("addSubjectPanel");
        if(p)p.hidden=true;
    }

    function subjectFromCard(card){
        const code=String(card?.dataset?.subject||"").trim();
        if(!code)return null;
        const strong=card.querySelector("strong");
        const small=card.querySelector("small");
        const iconEl=card.querySelector("span:not(.subject-delete-btn)");
        return {
            code,
            name:String(strong?.textContent||code).trim(),
            icon:String(iconEl?.textContent||"📚").trim()||"📚",
            id:slug(String(small?.textContent||code))||slug(code)
        };
    }

    async function openDeleteSubject(subject){
        const typed=window.prompt(
            `Delete "${subject.name}"?\n\nDelete karne ke liye exact Subject Name type karein:`
        );
        if(typed===null)return;
        if(typed.trim()!==subject.name){
            message("Exact Subject Name match nahi hua. Delete blocked.","error");
            return;
        }

        try{
            const response=await fetch("/api/cs/subjects",{
                method:"DELETE",
                headers:{"Content-Type":"application/json"},
                body:JSON.stringify({id:subject.id,name:subject.name}),
                cache:"no-store"
            });
            const data=await response.json().catch(()=>({}));
            if(!response.ok||!data.success) throw new Error(data.message||`HTTP ${response.status}`);
        }catch(error){
            message(`❌ ${error.message}`,"error");
            return;
        }

        const deleted=readJSON(DELETED_KEY,[]).map(x=>String(x).toUpperCase());
        if(!deleted.includes(subject.code.toUpperCase())) deleted.push(subject.code.toUpperCase());
        writeJSON(DELETED_KEY,deleted);

        const customs=readJSON(CUSTOM_KEY,[]).filter(x=>
            String(x.code||"").toUpperCase()!==subject.code.toUpperCase()
        );
        writeJSON(CUSTOM_KEY,customs);

        document.querySelector(`.subject-card[data-subject="${CSS.escape(subject.code)}"]`)?.remove();
        if(typeof currentSubject!=="undefined" && currentSubject===subject.code){
            currentSubject="";
            currentChapter=null;
            currentMainTopic=null;
            currentSubtopic=null;
            if(typeof updateSelectionUI==="function")updateSelectionUI();
        }
        message(`✅ ${subject.name} delete ho gaya.`,"success");
    }

    function addDeleteButton(card){
        if(!card || card.querySelector(".subject-delete-btn"))return;
        const subject=subjectFromCard(card);
        if(!subject)return;
        const btn=document.createElement("span");
        btn.className="subject-delete-btn";
        btn.textContent="🗑️";
        btn.title=`Delete ${subject.name}`;
        btn.setAttribute("role","button");
        btn.setAttribute("tabindex","0");
        btn.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();openDeleteSubject(subject);});
        btn.addEventListener("keydown",e=>{
            if(e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();openDeleteSubject(subject);}
        });
        card.appendChild(btn);
        card.classList.add("admin-subject-deletable");
    }

    function renderCustomSubjects(){
        const grid=getGrid();
        if(!grid)return;
        const deleted=readJSON(DELETED_KEY,[]).map(x=>String(x).toUpperCase());
        const customs=readJSON(CUSTOM_KEY,[]);
        customs.forEach(subject=>{
            if(deleted.includes(String(subject.code).toUpperCase()))return;
            if(grid.querySelector(`[data-subject="${CSS.escape(subject.code)}"]`))return;
            const card=document.createElement("button");
            card.type="button";
            card.className="subject-card admin-subject-deletable";
            card.dataset.subject=subject.code;
            card.innerHTML=`<span>${esc(subject.icon||"📚")}</span><strong>${esc(subject.name)}</strong><small>${esc(subject.code)}</small>`;
            card.addEventListener("click",()=>{
                if(typeof selectSubjectCard==="function")selectSubjectCard(subject.code);
            });
            grid.appendChild(card);
            addDeleteButton(card);

            // Add runtime maps so the existing admin UI can at least select the new subject.
            subjectIdMap[subject.code]=subject.id;
            subjectNameMap[subject.code]=`${subject.name} (${subject.code})`;
            mainTopicPlaceholderMap[subject.code]=`Main Topic Title (e.g. ${subject.name} Basics)`;
        });
    }

    window.addCustomSubject=async function(){
        const name=String(document.getElementById("newSubjectName")?.value||"").trim();
        const code=String(document.getElementById("newSubjectCode")?.value||"").trim().toUpperCase();
        const icon=String(document.getElementById("newSubjectIcon")?.value||"📘").trim()||"📘";

        if(!name){message("Subject Name daaliye.","error");return;}

        // If this Short Code was deleted earlier, explicitly tell the server that
        // this save is a re-add. This is what separates a legitimate re-add from
        // a normal duplicate Subject.
        const deletedBeforeAdd=readJSON(DELETED_KEY,[]).some(
            x=>String(x).trim().toUpperCase()===code
        );
        if(!code){message("Short Code daaliye.","error");return;}
        if(!/^[A-Z0-9][A-Z0-9_-]{0,24}$/.test(code)){
            message("Short Code mein sirf A-Z, 0-9, _ aur - use karein.","error");return;}
        let subject;
        try{
            const response=await fetch("/api/cs/subjects",{
                method:"POST",
                headers:{"Content-Type":"application/json"},
                body:JSON.stringify({name,code,icon,readd:deletedBeforeAdd}),
                cache:"no-store"
            });
            const data=await response.json().catch(()=>({}));
            if(!response.ok||!data.success) throw new Error(data.message||`HTTP ${response.status}`);
            subject=data.item;
        }catch(error){
            message(`❌ ${error.message}`,"error");
            return;
        }

        // A previously deleted Subject must be allowed to come back.
        // Remove its old browser-local "deleted" marker before rendering/saving
        // the new Subject, otherwise a refresh would hide the re-added card.
        const deleted=readJSON(DELETED_KEY,[]).filter(
            x=>String(x).toUpperCase()!==code
        );
        writeJSON(DELETED_KEY,deleted);

        // Keep a local copy only as a fast UI fallback; the server/Firestore registry is the source of truth.
        const customs=readJSON(CUSTOM_KEY,[]).filter(x=>String(x.code||"").toUpperCase()!==code);
        customs.push(subject);
        writeJSON(CUSTOM_KEY,customs);

        subjectIdMap[code]=subject.id;
        subjectNameMap[code]=`${subject.name} (${code})`;
        mainTopicPlaceholderMap[code]=`Main Topic Title (e.g. ${subject.name} Basics)`;

        const grid=getGrid();
        if(grid){
            const card=document.createElement("button");
            card.type="button";
            card.className="subject-card admin-subject-deletable";
            card.dataset.subject=code;
            card.innerHTML=`<span>${esc(subject.icon||icon)}</span><strong>${esc(subject.name)}</strong><small>${esc(subject.code)}</small>`;
            card.addEventListener("click",()=>{
                if(typeof selectSubjectCard==="function")selectSubjectCard(subject.code);
            });
            grid.appendChild(card);
            addDeleteButton(card);
        }

        document.getElementById("newSubjectName").value="";
        document.getElementById("newSubjectCode").value="";
        document.getElementById("newSubjectIcon").value="📘";
        closePanel();
        message(`✅ ${subject.name} subject save ho gaya. Course/Chapter bhi ready hai.`,"success");
    };

    function applySubjectManagement(){
        const grid=getGrid();
        if(!grid)return;
        const deleted=readJSON(DELETED_KEY,[]).map(x=>String(x).toUpperCase());
        grid.querySelectorAll(".subject-card").forEach(card=>{
            const code=String(card.dataset.subject||"");
            if(deleted.includes(code.toUpperCase())){
                card.remove();
                return;
            }
            addDeleteButton(card);
        });
        renderCustomSubjects();
    }

    function injectStyle(){
        const style=document.createElement("style");
        style.textContent=`
            .cs-subject-grid .subject-card{position:relative;}
            .cs-subject-grid .subject-delete-btn{
                position:absolute!important;left:8px!important;top:8px!important;
                width:30px!important;height:30px!important;border-radius:8px!important;
                display:flex!important;align-items:center!important;justify-content:center!important;
                background:#fee2e2!important;color:#b91c1c!important;
                cursor:pointer!important;font-size:15px!important;line-height:1!important;
                z-index:9999!important;box-sizing:border-box!important;
            }
            .cs-subject-grid .subject-delete-btn:hover{background:#fecaca!important;}
            .cs-subject-grid .subject-delete-btn:focus{outline:2px solid #ef4444!important;outline-offset:2px;}
        `;
        document.head.appendChild(style);
    }

    injectStyle();
    applySubjectManagement();
})();
