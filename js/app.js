/* =========================================
   COMPUTER SCIENCE NOTES + MCQ
   Main public application
   Same UI / quiz flow as the original project.
========================================= */

let subjects = [];

const app = document.getElementById("app");

async function loadCSSubjects() {
    try {
        const [subjectResponse, localResponse] = await Promise.all([
            fetch("/api/cs/subjects", { cache: "no-store" }),
            fetch("/data/cs-subjects.json", { cache: "no-store" })
        ]);

        if (!subjectResponse.ok) {
            throw new Error(`HTTP ${subjectResponse.status}`);
        }

        const data = await subjectResponse.json();
        if (!data?.success || !Array.isArray(data.items)) {
            throw new Error(data?.message || "Subject list load failed.");
        }

        // Built-in subjects come from the server registry.
        // Custom subjects are shown only when they also exist in the
        // persistent local CS subject registry. This prevents deleted
        // Firebase/stale custom subjects (for example old test subjects)
        // from reappearing on the public page.
        let localCustomIds = null;

        if (localResponse.ok) {
            try {
                const localData = await localResponse.json();
                if (Array.isArray(localData?.items)) {
                    localCustomIds = new Set(
                        localData.items
                            .map(item => String(item?.id || "").trim().toLowerCase())
                            .filter(Boolean)
                    );
                }
            } catch (error) {
                console.warn("Local CS subject registry parse failed:", error);
            }
        }

        subjects = data.items
            .filter(item => {
                if (item?.builtIn === true) return true;
                if (item?.deleted === true) return false;
                if (localCustomIds === null) return true;
                return localCustomIds.has(
                    String(item?.id || "").trim().toLowerCase()
                );
            })
            .map(item => ({
                id: String(item.id || "").trim(),
                name: String(item.name || item.id || "").trim(),
                icon: String(item.icon || "📚").trim() || "📚",
                description: String(
                    item.description || "Computer Science subject"
                ).trim()
            }))
            .filter(item => item.id && item.name);

        return subjects;
    } catch (error) {
        console.error("CS Subject List Load Error:", error);
        subjects = [];
        return subjects;
    }
}
const CS_PREFIX = "computerScienceChapterList:v1:";

function escapeHtml(value) {
    if (value === undefined || value === null) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function subjectById(subjectId) {
    return subjects.find(item => item.id === subjectId);
}

function chapterCacheKey(subjectId) {
    return `${CS_PREFIX}${subjectId}`;
}

function readChapterCache(subjectId) {
    try {
        const raw = localStorage.getItem(chapterCacheKey(subjectId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.chapters) ? parsed.chapters : null;
    } catch {
        return null;
    }
}

function saveChapterCache(subjectId, chapters) {
    try {
        localStorage.setItem(chapterCacheKey(subjectId), JSON.stringify({
            savedAt: Date.now(),
            chapters
        }));
    } catch (error) {
        console.warn("Chapter cache save skipped:", error);
    }
}

function extractBalancedArray(text, startIndex) {
    const firstBracket = text.indexOf("[", startIndex);
    if (firstBracket === -1) return null;

    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let i = firstBracket; i < text.length; i++) {
        const char = text[i];

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === "\\") {
                escaped = true;
                continue;
            }
            if (char === quote) quote = null;
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (char === "[") depth++;
        else if (char === "]") {
            depth--;
            if (depth === 0) return text.substring(firstBracket, i + 1);
        }
    }

    return null;
}

function getHTMLTitle(html) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch?.[1]) return "";

    const temp = document.createElement("div");
    temp.innerHTML = titleMatch[1];
    return (temp.textContent || temp.innerText || "").trim();
}

async function loadJSON(path) {
    if (!path) return null;
    try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error("JSON Load Error:", path, error);
        return null;
    }
}

async function loadMCQHTML(path) {
    if (!path) return null;
    try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) return null;

        const html = await response.text();
        const questionsIndex = html.indexOf("const questions");
        if (questionsIndex === -1) return null;

        const arrayText = extractBalancedArray(html, questionsIndex);
        if (!arrayText) return null;

        const questions = Function(`"use strict"; return (${arrayText});`)();
        if (!Array.isArray(questions)) return null;

        return { title: getHTMLTitle(html), questions };
    } catch (error) {
        console.error("MCQ HTML Load Error:", path, error);
        return null;
    }
}

/* =========================================
   ROUTER
========================================= */
function router() {
    const hash = window.location.hash || "#home";
    const parts = hash.substring(1).split("/");
    const page = parts[0];

    if (page === "home") {
        renderHome();
    } else if (page === "science" || page === "computer-science" || page === "subjects") {
        renderScience();
    } else if (page === "class") {
        // Old class route is intentionally removed from the CS public flow.
        renderScience();
    } else if (page === "subject") {
        renderChapterList(parts[1]);
    } else if (page === "mcq-sets") {
        renderMCQSetsPage(parts[1], Number(parts[2]));
    } else if (page === "read-notes") {
        renderNotes(parts[1], Number(parts[2]));
    } else if (page === "subtopic-mcq") {
        renderSubtopicMCQPage(decodeURIComponent(parts[1] || ""), Number(parts[2]), decodeURIComponent(parts[3] || ""), decodeURIComponent(parts[4] || ""));
    } else if (page === "quiz") {
        const subjectId = parts[1];
        const chapterNumber = Number(parts[2]);
        const jsonStart = parts[3] === "json" || parts[4] === "json";
        const setId = parts[3] && parts[3] !== "direct" && parts[3] !== "json"
            ? decodeURIComponent(parts[3])
            : null;
        const directStart = parts[3] === "direct" || parts[4] === "direct";
        renderQuizPage(subjectId, chapterNumber, directStart, setId, jsonStart);
    } else {
        renderHome();
    }
}

/* =========================================
   HOME
========================================= */
function renderHome() {
    app.innerHTML = `
        <section class="hero">
            <div class="hero-icon">💻</div>
            <h1>Computer Science Notes + MCQ</h1>
            <p>Computer Science Notes और MCQ Practice</p>
        </section>

        <section class="section">
            <h2 class="section-title">Computer Science</h2>
            <div class="card-grid">
                <div class="card">
                    <div class="card-icon">💻</div>
                    <h3>Computer Science</h3>
                    <p>AI, CN, DSA, DBMS, Digital Electronics, OS, TOC और अन्य Computer Science subjects.</p>
                    <button class="btn" onclick="location.hash='science'">Explore</button>
                </div>
            </div>
        </section>
    `;
}

/* =========================================
   SUBJECT LIST — NO CLASS PAGE
========================================= */
async function renderScience() {
    await loadCSSubjects();

    app.innerHTML = `
        <button class="back-btn" onclick="location.hash='home'">← Back to Home</button>

        <div class="page-header">
            <h1>💻 Computer Science</h1>
            <p>Select a subject to explore Notes and MCQs</p>
        </div>

        <div class="card-grid">
            ${subjects.map(subject => `
                <div class="card">
                    <div class="card-icon">${subject.icon}</div>
                    <h3>${escapeHtml(subject.name)}</h3>
                    <p>${escapeHtml(subject.description)}</p>
                    <button class="btn" onclick="location.hash='subject/${subject.id}'">Explore</button>
                </div>
            `).join("")}
        </div>
    `;
}

/* =========================================
   CHAPTER LIST — SAME EXISTING FORMAT
========================================= */
function renderChapterRows(subjectId, chapters) {
    const loading = document.getElementById("chapterLoading");

    if (!chapters.length) {
        if (loading) {
            loading.innerHTML = `
                <h2>No Topics Found</h2>
                <p>इस subject के topics अभी उपलब्ध नहीं हैं।</p>
            `;
        }
        return;
    }

    if (loading) loading.remove();

    const oldContainer = app.querySelector(".chapter-list");
    if (oldContainer) oldContainer.remove();

    const chapterContainer = document.createElement("div");
    chapterContainer.className = "chapter-list";

    chapters.forEach(chapter => {
        const mcqSets = Array.isArray(chapter.mcqSets) ? chapter.mcqSets : [];
        const chapterTitle = chapter.title || chapter.mcq?.title || `Topic ${chapter.number}`;

        const row = document.createElement("div");
        row.className = "chapter-item";

        const left = document.createElement("div");
        left.className = "chapter-name";
        left.innerHTML = `
            <strong>Topic ${chapter.number}</strong>
            <span>${escapeHtml(chapterTitle)}</span>
        `;

        const actions = document.createElement("div");
        actions.className = "chapter-actions";

        if (mcqSets.length > 0) {
            const mcqButton = document.createElement("button");
            mcqButton.className = "btn btn-green";
            mcqButton.type = "button";
            mcqButton.textContent = `📝 MCQ (${mcqSets.length} Set${mcqSets.length === 1 ? "" : "s"})`;
            mcqButton.onclick = () => {
                location.hash = `mcq-sets/${subjectId}/${chapter.number}`;
            };
            actions.appendChild(mcqButton);
        } else {
            const noMCQ = document.createElement("span");
            noMCQ.style.cssText = "color:#777;font-size:15px;";
            noMCQ.textContent = "MCQ अभी उपलब्ध नहीं";
            actions.appendChild(noMCQ);
        }

        row.appendChild(left);
        row.appendChild(actions);
        chapterContainer.appendChild(row);
    });

    app.appendChild(chapterContainer);
}

async function loadSubjectNotes(subjectId) {
    try {
        const response = await fetch(`/api/cs/subject-notes/${encodeURIComponent(subjectId)}`, { cache: "no-store" });
        if (!response.ok) return null;
        const data = await response.json();
        return data?.success && data?.exists && data?.notesUrl ? data : null;
    } catch {
        return null;
    }
}

async function renderChapterList(subjectId) {
    const subject = subjectById(subjectId);
    if (!subject) {
        renderScience();
        return;
    }

    let hierarchy = [];
    let subjectNotes = null;

    try {
        const [hierarchyResponse, notesResponse] = await Promise.all([
            fetch(`/api/cs/public-hierarchy-v2/${encodeURIComponent(subjectId)}`, { cache: "no-store" }),
            fetch(`/api/cs/subject-notes/${encodeURIComponent(subjectId)}`, { cache: "no-store" })
        ]);

        if (hierarchyResponse.ok) {
            const data = await hierarchyResponse.json();
            if (data?.success && Array.isArray(data.items)) hierarchy = data.items;
        }

        if (notesResponse.ok) {
            const data = await notesResponse.json();
            if (data?.success && data?.exists && data?.notesUrl) subjectNotes = data;
        }
    } catch (error) {
        console.error("CS public hierarchy load error:", error);
    }

    const currentParts = (window.location.hash || "#home").substring(1).split("/");
    if (currentParts[0] !== "subject" || currentParts[1] !== subjectId) return;

    app.innerHTML = `
        <button class="back-btn" onclick="location.hash='science'">← Back to Subjects</button>
        <div class="page-header">
            <h1>${subject.icon} ${escapeHtml(subject.name)}</h1>
            <p>Topics, Notes and MCQ Practice</p>
        </div>
        ${subjectNotes?.notesUrl ? `
            <div style="display:flex;justify-content:center;align-items:center;margin:16px 0 20px;">
                <button id="commonSubjectNotesBtn" class="btn btn-blue" type="button">📖 ${escapeHtml(subject.name)} Notes</button>
            </div>
        ` : ""}
        <div class="chapter-list" id="csMainTopicList"></div>
    `;

    const notesButton = document.getElementById("commonSubjectNotesBtn");
    if (notesButton && subjectNotes?.notesUrl) notesButton.onclick = () => window.open(subjectNotes.notesUrl, "_blank", "noopener,noreferrer");

    const list = document.getElementById("csMainTopicList");
    if (!hierarchy.length) {
        list.innerHTML = `<div class="card"><h2>Topics अभी उपलब्ध नहीं</h2><p>इस subject के Main Topics अभी add नहीं किए गए हैं।</p></div>`;
        return;
    }

    hierarchy.forEach((main, index) => {
        const row = document.createElement("div");
        row.className = "chapter-item";
        row.innerHTML = `
            <div class="chapter-name"><strong>Topic ${index + 1}</strong><span>${escapeHtml(main.title || "")}</span></div>
            <div class="chapter-actions"><button class="btn btn-blue" type="button">⌄ Open</button></div>
        `;

        const btn = row.querySelector("button");
        const children = Array.isArray(main.subtopics) ? main.subtopics : [];
        const childBox = document.createElement("div");
        childBox.style.cssText = "display:none;margin:0 0 16px;padding:14px 18px 6px;background:#f5faf7;border:1px solid #e2eee5;border-top:0;border-radius:0 0 12px 12px;";

        if (!children.length) {
            childBox.innerHTML = '<div style="color:#667085;padding:8px 0">Subtopics अभी उपलब्ध नहीं</div>';
        } else {
            children.forEach((sub, subIndex) => {
                const sets = Array.isArray(sub.mcqSets) ? sub.mcqSets : [];
                const item = document.createElement("div");
                item.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #e5e7eb;";
                item.innerHTML = `<div><div style="font-weight:600;color:#253047">${subIndex + 1}. ${escapeHtml(sub.title || "")}</div></div><div><button class="btn btn-green" type="button">📝 MCQ (${sets.length} Set${sets.length === 1 ? "" : "s"})</button></div>`;
                item.querySelector("button").onclick = () => {
                    if (!sets.length) { alert("Is Subtopic ke liye MCQ abhi available nahi hai."); return; }
                    location.hash = `subtopic-mcq/${encodeURIComponent(subjectId)}/${encodeURIComponent(main.chapterNumber)}/${encodeURIComponent(sub.id)}/${encodeURIComponent(sub.title || "")}`;
                };
                childBox.appendChild(item);
            });
        }

        btn.onclick = () => {
            const open = childBox.style.display !== "none";
            childBox.style.display = open ? "none" : "block";
            btn.textContent = open ? "⌄ Open" : "⌃ Close";
        };

        list.appendChild(row);
        list.appendChild(childBox);
    });
}


window.addEventListener("storage", function (event) {
    if (!event.key || !event.key.startsWith(CS_PREFIX)) return;
    const parts = (window.location.hash || "#home").substring(1).split("/");
    if (parts[0] === "subject" && parts[1]) renderChapterList(parts[1]);
});

/* =========================================
   MCQ SETS PAGE — SAME CARD FORMAT
========================================= */
async function renderMCQSetsPage(subjectId, chapterNumber) {
    const subject = subjectById(subjectId);

    app.innerHTML = `
        <button class="back-btn" onclick="location.hash='subject/${subjectId}'">← Back to Chapters</button>
        <div class="page-header">
            <h1>${subject?.icon || "📝"} MCQ Practice</h1>
            <p>${escapeHtml(subject?.name || subjectId)} — Topic ${chapterNumber}</p>
        </div>
        <div id="mcqSetsLoading" class="card">
            <h2>Loading MCQ Sets...</h2>
            <p>Please wait.</p>
        </div>
    `;

    let items = [];

    try {
        const response = await fetch(`/api/cs/mcq-html/${encodeURIComponent(subjectId)}/${chapterNumber}`, { cache: "no-store" });
        if (response.ok) {
            const data = await response.json();
            items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
        }
    } catch (error) {
        console.error("MCQ Sets HTML load error:", error);
    }

    try {
        const response = await fetch(`/api/cs/mcqs/${encodeURIComponent(subjectId)}/${chapterNumber}`, { cache: "no-store" });
        if (response.ok) {
            const result = await response.json();
            if (result?.success && result?.exists && result?.data && Array.isArray(result.data.questions)) {
                items.push({
                    id: "saved-json-mcq",
                    name: result.data.title || result.data.chapterTitle || `Chapter ${chapterNumber} JSON MCQ`,
                    questionCount: result.data.questions.length,
                    isJSON: true,
                    url: `/#quiz/${subjectId}/${chapterNumber}/json/direct`
                });
            }
        }
    } catch (error) {
        console.error("Saved JSON MCQ load error:", error);
    }

    const loading = document.getElementById("mcqSetsLoading");
    if (!items.length) {
        loading.innerHTML = `
            <h2>MCQ अभी उपलब्ध नहीं</h2>
            <p>इस topic के लिए अभी कोई MCQ Set upload/save नहीं किया गया है।</p>
        `;
        return;
    }

    loading.remove();
    const container = document.createElement("div");
    container.className = "card-grid";

    items.forEach((item, index) => {
        const card = document.createElement("div");
        card.className = "card";
        const name = item.name || item.originalName || item.fileName || `MCQ Set ${index + 1}`;
        const count = item.questionCount ?? "—";

        card.innerHTML = `
            <div class="card-icon">📝</div>
            <h3>Set ${index + 1}</h3>
            <p>${escapeHtml(name)}</p>
            <p><strong>${escapeHtml(count)}</strong> Questions</p>
            <button class="btn btn-green" type="button">▶ Start MCQ</button>
        `;

        card.querySelector("button").onclick = () => {
            if (item.isJSON) {
                location.hash = `quiz/${subjectId}/${chapterNumber}/json/direct`;
                return;
            }
            if (!item.id) {
                alert("MCQ Set ID nahi mila.");
                return;
            }
            location.hash = `quiz/${subjectId}/${chapterNumber}/${encodeURIComponent(item.id)}/direct`;
        };

        container.appendChild(card);
    });

    app.appendChild(container);
}

/* =========================================
   NOTES PAGE
========================================= */
async function renderNotes(subjectId, chapterNumber) {
    const subject = subjectById(subjectId);
    const response = await fetch(`/api/cs/chapter-notes/${encodeURIComponent(subjectId)}/${chapterNumber}`, { cache: "no-store" }).catch(() => null);
    const notes = response?.ok ? await response.json().catch(() => null) : null;

    if (notes?.success && notes?.exists && notes.notesUrl) {
        window.location.href = notes.notesUrl;
        return;
    }

    app.innerHTML = `
        <button class="back-btn" onclick="location.hash='subject/${subjectId}'">← Back to Chapters</button>
        <div class="card">
            <h2>Notes Not Found</h2>
            <p>इस topic की Notes अभी उपलब्ध नहीं हैं।</p>
        </div>
    `;
}

async function renderSubtopicMCQPage(subjectId, chapterNumber, subtopicId, title) {
    const subject = subjectById(subjectId);
    app.innerHTML = `<button class="back-btn" onclick="location.hash='subject/${encodeURIComponent(subjectId)}'">← Back to Topics</button><div class="page-header"><h1>📝 MCQ Practice</h1><p>${escapeHtml(subject?.name || subjectId)} — ${escapeHtml(title)}</p></div><div id="csSetLoading" class="card"><h2>Loading MCQ Sets...</h2><p>Please wait.</p></div>`;
    let items = [];
    try {
        const response = await fetch(`/api/cs/mcq-html/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterNumber)}?subtopicId=${encodeURIComponent(subtopicId)}`, { cache: "no-store" });
        if (response.ok) { const data = await response.json(); items = Array.isArray(data.items) ? data.items : []; }
    } catch (error) { console.error("CS subtopic MCQ load error:", error); }
    const loading = document.getElementById("csSetLoading");
    if (!items.length) { loading.innerHTML = `<h2>MCQ अभी उपलब्ध नहीं</h2><p>इस Subtopic के लिए अभी कोई MCQ Set upload नहीं किया गया है।</p>`; return; }
    loading.remove();
    const grid = document.createElement("div"); grid.className = "card-grid";
    items.forEach((item,index) => {
        const card=document.createElement("div"); card.className="card";
        card.innerHTML=`<div class="card-icon">📝</div><h3>Set ${index+1}</h3><p>${escapeHtml(item.name||item.originalName||"MCQ Set")}</p><p><strong>${Number(item.questionCount||0)}</strong> Questions</p><button class="btn btn-green" type="button">▶ Start MCQ</button>`;
        card.querySelector("button").onclick=()=>{location.hash=`quiz/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterNumber)}/${encodeURIComponent(item.id)}/direct`;};
        grid.appendChild(card);
    });
    app.appendChild(grid);
}

/* =========================================
   QUIZ PAGE — EXISTING quiz.js IS REUSED
========================================= */
async function renderQuizPage(subjectId, chapterNumber, directStart = false, mcqSetId = null, forceJSON = false) {
    const subject = subjectById(subjectId);

    app.innerHTML = `
        <button class="back-btn" onclick="location.hash='subject/${subjectId}'">← Back to Chapters</button>
        <div class="page-header quiz-page-header">
            <h1>${subject?.icon || "📝"} ${escapeHtml(subject?.name || "MCQ")} — Topic ${chapterNumber}</h1>
            <p>Computer Science MCQ Practice</p>
        </div>
        <div id="quizApp">
            <div class="card">
                <h2>Loading Questions...</h2>
                <p>Please wait.</p>
            </div>
        </div>
    `;

    let mcqData = null;

    if (forceJSON) {
        try {
            const response = await fetch(`/api/cs/mcqs/${encodeURIComponent(subjectId)}/${chapterNumber}`, { cache: "no-store" });
            if (response.ok) {
                const result = await response.json();
                if (result?.success && result?.exists) mcqData = result.data;
            }
        } catch (error) {
            console.error("MCQ JSON API Load Error:", error);
        }
    }

    if (!mcqData && mcqSetId) {
        try {
            const response = await fetch(`/api/cs/mcq-html/${encodeURIComponent(subjectId)}/${chapterNumber}`, { cache: "no-store" });
            if (response.ok) {
                const data = await response.json();
                const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
                const selectedItem = items.find(item => String(item.id) === String(mcqSetId));
                if (selectedItem?.url) mcqData = await loadMCQHTML(selectedItem.url);
            }
        } catch (error) {
            console.error("Selected MCQ Set load error:", error);
        }
    }

    if (!mcqData) {
        try {
            const response = await fetch(`/api/cs/mcqs/${encodeURIComponent(subjectId)}/${chapterNumber}`, { cache: "no-store" });
            if (response.ok) {
                const result = await response.json();
                if (result?.success && result?.exists) mcqData = result.data;
            }
        } catch (error) {
            console.error("MCQ load error:", error);
        }
    }

    if (!mcqData) {
        document.getElementById("quizApp").innerHTML = `
            <div class="card">
                <h2>No Questions</h2>
                <p>इस topic में अभी questions उपलब्ध नहीं हैं।</p>
            </div>
        `;
        return;
    }

    if (typeof initializeQuizSystem === "function") {
        // "CS" is only an internal metadata value; no class page is shown to users.
        initializeQuizSystem(mcqData, "CS", subjectId, chapterNumber);
    } else {
        document.getElementById("quizApp").innerHTML = `
            <div class="card">
                <h2>Quiz System Error</h2>
                <p>quiz.js load नहीं हुआ।</p>
            </div>
        `;
    }
}

window.addEventListener("hashchange", router);

window.addEventListener("DOMContentLoaded", async () => {
    await loadCSSubjects();
    router();
});

function goHome() {
    location.hash = "home";
}
