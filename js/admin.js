"use strict";

let currentSubject = "";
let currentChapter = null;
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
    currentSubject=subject;

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

    const notesUrl=getElementOptional("notesUrl");
    if(notesUrl) notesUrl.value="";

    const notesMessage=getElementOptional("notesMessage");
    if(notesMessage) notesMessage.style.display="none";

    updateSelectionUI();
}

/* HTML subject cards call this exact function name. */
window.selectSubjectCard=function(subject){
    selectSubject(subject);
};

window.selectSubject=selectSubject;

function updateSelectionUI(){
    const chapterInput=getElementOptional("chapterNumber");

    /*
     * Current CS Admin UI no longer has a Chapter Number input.
     * The server assigns chapter numbers automatically.
     */
    if(chapterInput){
        const chapterValue=chapterInput.value.trim();
        currentChapter=chapterValue?Number(chapterValue):null;
    }

    const subjectText=currentSubject
        ? (subjectNameMap[currentSubject]||currentSubject)
        : "Select Subject";

    const chapterText=currentChapter&&currentChapter>0
        ? `Topic ${currentChapter}`
        : "";

    const title=getElementOptional("currentSubjectTitle");
    if(title) title.textContent=subjectText;

    const badge=getElementOptional("selectionBadge");
    if(badge) badge.textContent=chapterText
        ? `${subjectText} • ${chapterText}`
        : subjectText;

    const uploadSubject=getElementOptional("uploadSubjectText");
    if(uploadSubject) uploadSubject.textContent=currentSubject?subjectText:"—";

    const uploadChapter=getElementOptional("uploadChapterText");
    if(uploadChapter) uploadChapter.textContent=currentChapter||"—";

    const description=getElementOptional("listDescription");
    if(description){
        description.textContent=currentSubject&&currentChapter
            ? `${subjectText} • Topic ${currentChapter}`
            : "Selected subject ke uploaded MCQ yahan dikhenge.";
    }
}

const chapterNumberInput=getElementOptional("chapterNumber");
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
    if(!currentChapter||currentChapter<1) throw new Error("Pehle Topic save/select karein.");
    return {subject:subjectIdMap[currentSubject],chapterNumber:currentChapter};
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
    if(!currentSubject||!subjectIdMap[currentSubject]){
        getElement("quizList").innerHTML=
            `<div class="empty">Pehle Subject select karein.</div>`;
        getElement("mcqCountBadge").textContent="0 MCQ Sets";
        return;
    }

    const list=getElement("quizList");
    list.innerHTML="<div class='empty'>Loading Topics and MCQ...</div>";
    getElement("mcqCountBadge").textContent="0 MCQ Sets";

    try{
        const subjectId=subjectIdMap[currentSubject];

        const r=await fetch(
            `/api/cs/chapters/${encodeURIComponent(subjectId)}`,
            {cache:"no-store"}
        );
        const d=await r.json();

        if(!r.ok||!d.success){
            throw new Error(d.message||"Topics load nahi hue.");
        }

        const chapters=Array.isArray(d.items)?d.items:[];

        if(!chapters.length){
            list.innerHTML=
                `<div class="empty">Is Subject ke liye abhi koi Topic saved nahi hai.</div>`;
            return;
        }

        const rows=[];
        let totalQuestions=0;

        for(const chapter of chapters){
            const number=Number(chapter.number);
            if(!number) continue;

            let htmlItems=[];
            try{
                const hr=await fetch(
                    `/api/cs/mcq-html/${encodeURIComponent(subjectId)}/${number}`,
                    {cache:"no-store"}
                );
                if(hr.ok){
                    const hd=await hr.json();
                    htmlItems=Array.isArray(hd.items)?hd.items:[];
                }
            }catch{}

            const chapterQuestions=htmlItems.reduce(
                (sum,item)=>sum+Number(item.questionCount||0),0
            );
            totalQuestions+=chapterQuestions;

            const row=document.createElement("div");
            row.className="quiz-item";

            const title=chapter.title||chapter.chapterTitle||`Topic ${number}`;

            row.innerHTML=`
                <div class="quiz-name">
                    Topic ${number} — ${escapeHTML(title)}
                </div>
                <div class="quiz-info">
                    MCQs: ${chapterQuestions}
                </div>
                <div class="actions"></div>
            `;

            const actions=row.querySelector(".actions");

            const selectButton=document.createElement("button");
            selectButton.className="open-btn";
            selectButton.textContent="📌 Select Topic";
            selectButton.onclick=function(){
                currentChapter=number;
                getElement("chapterTitle").value=title;
                updateSelectionUI();
            };
            actions.appendChild(selectButton);

            htmlItems.forEach(item=>{
                const open=document.createElement("a");
                open.className="open-btn";
                open.href=item.url||"#";
                open.target="_blank";
                open.rel="noopener";
                open.textContent=`▶ ${item.name||item.originalName||"Open MCQ"}`;
                actions.appendChild(open);

                const rename=document.createElement("button");
                rename.className="rename-btn";
                rename.textContent="✏ Rename";
                rename.onclick=()=>renameQuiz(subjectId,number,item.id,item.name||item.originalName||"MCQ Quiz");
                actions.appendChild(rename);

                const del=document.createElement("button");
                del.className="delete-btn";
                del.textContent="🗑 Delete";
                del.onclick=()=>deleteQuizForTopic(subjectId,number,item.id);
                actions.appendChild(del);
            });

            rows.push(row);
        }

        list.innerHTML="";
        rows.forEach(row=>list.appendChild(row));
        getElement("mcqCountBadge").textContent=
            `${totalQuestions} MCQ${totalQuestions===1?"":"s"}`;

    }catch(e){
        console.error(e);
        list.innerHTML=
            `<div class="empty">Server error: ${escapeHTML(e.message)}</div>`;
        getElement("mcqCountBadge").textContent="0 MCQ Sets";
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
    const file=getElement("mcqFile").files[0];
    if(!file){showMessage("uploadMessage","Pehle HTML file select karo.","error");return;}
    if(!/\.html?$/i.test(String(file.name||""))){
        showMessage("uploadMessage","Sirf HTML file upload karo.","error");return;
    }

    const fd=new FormData();
    fd.append("mcqFile",file,file.name);
    fd.append("subject",String(inputs.subject));
    fd.append("chapterNumber",String(inputs.chapterNumber));

    try{
        showMessage("uploadMessage","⏳ Uploading MCQ HTML...","success");
        const r=await fetch("/api/cs/mcq-html/upload",{
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
