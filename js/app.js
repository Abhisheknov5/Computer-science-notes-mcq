/* =========================================
   NCERT NOTES + MCQ
   MAIN APPLICATION
========================================= */

const subjects = [
    {
        id: "physics",
        name: "Physics",
        icon: "⚛️",
        description:
            "Motion, Force, Energy, Electricity and other Physics topics."
    },
    {
        id: "chemistry",
        name: "Chemistry",
        icon: "🧪",
        description:
            "Matter, Atoms, Reactions, Acids, Bases and more."
    },
    {
        id: "biology",
        name: "Biology",
        icon: "🧬",
        description:
            "Living Organisms, Plants, Human Body and Life Processes."
    },
    {
        id: "environmental-science",
        name: "Environmental Science",
        icon: "🌱",
        description:
            "Environment, Ecosystems, Natural Resources and Conservation."
    }
];

const classes = [6, 7, 8, 9, 10, 11, 12];

const app = document.getElementById("app");


/* =========================================
   CLASS 6 PHYSICS
   COMMON NOTES GOOGLE DOC
========================================= */

const COMMON_NOTES_URL =
    "https://docs.google.com/document/d/1krZ9Puyn1JuFtiaTeyxNtXRbFJWSAFhcCeSdpi0j22Y/edit?tab=t.0#heading=h.c7ziergcxtih";


/* =========================================
   CLASS 6 PHYSICS
   ACTUAL NCERT CHAPTERS
========================================= */

const CLASS6_PHYSICS_CHAPTERS = [
    {
        number: 7,
        title:
            "गति एवं दूरियों का मापन (Motion and Measurement of Distances)"
    },
    {
        number: 8,
        title:
            "प्रकाश–छायाएँ एवं परावर्तन (Light, Shadows and Reflections)"
    },
    {
        number: 9,
        title:
            "विद्युत तथा परिपथ (Electricity and Circuits)"
    },
    {
        number: 10,
        title:
            "चुंबकों द्वारा मनोरंजन (Fun with Magnets)"
    }
];


/* =========================================
   SUBJECT FOLDER MAP
========================================= */

const subjectFolderMap = {
    physics: "Physics",
    chemistry: "Chemistry",
    biology: "Biology",
    "environmental-science": "Environmental-Science"
};


/* =========================================
   HTML ESCAPE
========================================= */

function escapeHtml(value) {

    if (
        value === undefined ||
        value === null
    ) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================
   JSON PATH
========================================= */

function getJSONPath(
    classNumber,
    subjectId,
    chapterNumber,
    type
) {

    const folder =
        type === "notes"
            ? "Notes"
            : "MCQ";

    const subjectFolder =
        subjectFolderMap[subjectId];

    if (!subjectFolder) {

        console.error(
            "Unknown subject:",
            subjectId
        );

        return "";
    }

    const fileNumber =
        String(chapterNumber).padStart(2, "0");

    return (
        `data/class${classNumber}/` +
        `${folder}/` +
        `${subjectFolder}/` +
        `chapter-${fileNumber}.json`
    );
}


/* =========================================
   MCQ HTML PATH
   CLASS 6 PHYSICS ONLY
========================================= */

function getMCQHTMLPath(
    classNumber,
    subjectId,
    chapterNumber
) {

    const fileNumber =
        String(chapterNumber).padStart(2, "0");

    return (
        `data/class${classNumber}/` +
        `MCQ/` +
        `${subjectFolderMap[subjectId]}/` +
        `chapter-${fileNumber}.html`
    );
}


/* =========================================
   LOAD JSON
========================================= */

async function loadJSON(path) {

    if (!path) {
        return null;
    }

    try {

        const response =
            await fetch(path, {
                cache: "no-store"
            });

        if (!response.ok) {

            console.warn(
                `JSON not found: ${path} (${response.status})`
            );

            return null;
        }

        return await response.json();

    }

    catch (error) {

        console.error(
            "JSON Load Error:",
            path,
            error
        );

        return null;
    }
}


/* =========================================
   FIND BALANCED ARRAY
   Used for extracting:
   const questions = [ ... ];
========================================= */

function extractBalancedArray(
    text,
    startIndex
) {

    const firstBracket =
        text.indexOf(
            "[",
            startIndex
        );

    if (firstBracket === -1) {
        return null;
    }

    let depth = 0;

    let quote = null;

    let escaped = false;

    for (
        let i = firstBracket;
        i < text.length;
        i++
    ) {

        const char =
            text[i];

        if (quote) {

            if (escaped) {

                escaped = false;

                continue;
            }

            if (char === "\\") {

                escaped = true;

                continue;
            }

            if (char === quote) {

                quote = null;
            }

            continue;
        }


        if (
            char === '"' ||
            char === "'" ||
            char === "`"
        ) {

            quote = char;

            continue;
        }


        if (char === "[") {

            depth++;
        }

        else if (char === "]") {

            depth--;

            if (depth === 0) {

                return text.substring(
                    firstBracket,
                    i + 1
                );
            }
        }
    }

    return null;
}


/* =========================================
   LOAD MCQ HTML
========================================= */

async function loadMCQHTML(path) {

    if (!path) {
        return null;
    }

    try {

        const response =
            await fetch(path, {
                cache: "no-store"
            });

        if (!response.ok) {

            console.warn(
                `MCQ HTML not found: ${path} (${response.status})`
            );

            return null;
        }


        const html =
            await response.text();


        const questionsIndex =
            html.indexOf(
                "const questions"
            );


        if (questionsIndex === -1) {

            console.error(
                "questions array not found:",
                path
            );

            return null;
        }


        const arrayText =
            extractBalancedArray(
                html,
                questionsIndex
            );


        if (!arrayText) {

            console.error(
                "Questions array could not be extracted:",
                path
            );

            return null;
        }


        const questions =
            Function(
                `"use strict"; return (${arrayText});`
            )();


        if (!Array.isArray(questions)) {

            console.error(
                "Extracted questions is not an array:",
                path
            );

            return null;
        }


        return {

            title:
                getHTMLTitle(html),

            questions:
                questions

        };

    }

    catch (error) {

        console.error(
            "MCQ HTML Load Error:",
            path,
            error
        );

        return null;
    }
}


/* =========================================
   GET HTML TITLE
========================================= */

function getHTMLTitle(html) {

    const titleMatch =
        html.match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
        );


    if (
        titleMatch &&
        titleMatch[1]
    ) {

        const temp =
            document.createElement(
                "div"
            );

        temp.innerHTML =
            titleMatch[1];

        return (
            temp.textContent ||
            temp.innerText ||
            ""
        ).trim();
    }


    return "";
}


/* =========================================
   GET MCQ DATA
   CLASS 6 PHYSICS:
   HTML

   OTHER:
   JSON
========================================= */

async function loadMCQData(
    classNumber,
    subjectId,
    chapterNumber
) {

    /* Class 6 Physics: HTML first, JSON fallback */
    if (
        classNumber === 6 &&
        subjectId === "physics"
    ) {

        const htmlPath =
            getMCQHTMLPath(
                classNumber,
                subjectId,
                chapterNumber
            );

        const htmlData =
            await loadMCQHTML(
                htmlPath
            );

        if (htmlData) {
            return htmlData;
        }

        const jsonPath =
            getJSONPath(
                classNumber,
                subjectId,
                chapterNumber,
                "mcq"
            );

        return await loadJSON(jsonPath);
    }

    const path =
        getJSONPath(
            classNumber,
            subjectId,
            chapterNumber,
            "mcq"
        );

    return await loadJSON(path);
}


/* =========================================
   ROUTER
========================================= */

function router() {

    const hash =
        window.location.hash || "#home";

    const parts =
        hash
            .substring(1)
            .split("/");

    const page =
        parts[0];


    if (page === "home") {

        renderHome();

    }

    else if (page === "science") {

        renderScience();

    }

    else if (page === "class") {

        const classNumber =
            Number(parts[1]);

        renderClassPage(
            classNumber
        );

    }

    else if (page === "subject") {

        const classNumber =
            Number(parts[1]);

        const subjectId =
            parts[2];

        renderChapterList(
            classNumber,
            subjectId
        );

    }

    else if (page === "mcq-sets") {

        const classNumber =
            Number(parts[1]);

        const subjectId =
            parts[2];

        const chapterNumber =
            Number(parts[3]);

        renderMCQSetsPage(
            classNumber,
            subjectId,
            chapterNumber
        );

    }

    else if (page === "read-notes") {

        const classNumber =
            Number(parts[1]);

        const subjectId =
            parts[2];

        const chapterNumber =
            Number(parts[3]);

        renderNotes(
            classNumber,
            subjectId,
            chapterNumber
        );

    }

    else if (page === "quiz") {

        const classNumber =
            Number(parts[1]);

        const subjectId =
            parts[2];

        const chapterNumber =
            Number(parts[3]);

        const jsonStart =
            parts[4] === "json" ||
            parts[5] === "json";

        const setId =
            parts[4] &&
            parts[4] !== "direct" &&
            parts[4] !== "json"
                ? decodeURIComponent(parts[4])
                : null;

        const directStart =
            parts[4] === "direct" ||
            parts[5] === "direct";

        renderQuizPage(
            classNumber,
            subjectId,
            chapterNumber,
            directStart,
            setId,
            jsonStart
        );

    }

    else {

        renderHome();

    }
}


/* =========================================
   HOME
========================================= */

function renderHome() {

    app.innerHTML = `

        <section class="hero">

            <div class="hero-icon">
                📚
            </div>

            <h1>
                NCERT Notes + MCQ
            </h1>

            <p>
                NCERT आधारित Notes और MCQ Practice
            </p>

        </section>


        <section class="section">

            <h2 class="section-title">
                General Science
            </h2>

            <div class="card-grid">

                <div class="card">

                    <div class="card-icon">
                        🔬
                    </div>

                    <h3>
                        General Science
                    </h3>

                    <p>
                        Physics, Chemistry, Biology
                        और Environmental Science
                    </p>

                    <button
                        class="btn"
                        onclick="location.hash='science'"
                    >
                        Explore
                    </button>

                </div>

            </div>

        </section>
    `;
}


/* =========================================
   GENERAL SCIENCE
========================================= */

function renderScience() {

    app.innerHTML = `

        <button
            class="back-btn"
            onclick="location.hash='home'"
        >
            ← Back to Home
        </button>


        <div class="page-header">

            <h1>
                🔬 General Science
            </h1>

            <p>
                Select your class to explore
                NCERT Notes and MCQs
            </p>

        </div>


        <div class="card-grid">

            ${classes.map(classNumber => `

                <div class="card">

                    <div class="card-icon">
                        📘
                    </div>

                    <h3>
                        Class ${classNumber}
                    </h3>

                    <p>
                        Notes & MCQs
                    </p>

                    <button
                        class="btn"
                        onclick="location.hash='class/${classNumber}'"
                    >
                        Explore
                    </button>

                </div>

            `).join("")}

        </div>
    `;
}


/* =========================================
   CLASS PAGE
========================================= */

function renderClassPage(
    classNumber
) {

    if (
        !classes.includes(
            classNumber
        )
    ) {

        renderScience();

        return;
    }


    app.innerHTML = `

        <button
            class="back-btn"
            onclick="location.hash='science'"
        >
            ← Back to General Science
        </button>


        <div class="page-header">

            <h1>
                📘 Class ${classNumber} - General Science
            </h1>

            <p>
                Choose a subject
            </p>

        </div>


        <div class="card-grid">

            ${subjects.map(subject => `

                <div class="card">

                    <div class="card-icon">
                        ${subject.icon}
                    </div>

                    <h3>
                        ${subject.name}
                    </h3>

                    <p>
                        ${subject.description}
                    </p>

                    <button
                        class="btn"
                        onclick="location.hash='subject/${classNumber}/${subject.id}'"
                    >
                        Explore
                    </button>

                </div>

            `).join("")}

        </div>
    `;
}


/* =========================================
   CHAPTER LIST CACHE
   Cache is only for the lightweight chapter list.
   Notes/quiz content is still loaded from the server
   when the user opens it.
========================================= */

const CHAPTER_CACHE_PREFIX = "ncertChapterList:v2:";
const CHAPTER_CACHE_BUSTER_KEY = "ncertChapterList:buster";

function getChapterCacheKey(classNumber, subjectId) {
    return `${CHAPTER_CACHE_PREFIX}${classNumber}:${subjectId}`;
}

function readChapterCache(classNumber, subjectId) {
    try {
        const raw = localStorage.getItem(
            getChapterCacheKey(classNumber, subjectId)
        );

        if (!raw) return null;

        const parsed = JSON.parse(raw);

        if (!parsed || !Array.isArray(parsed.chapters)) {
            return null;
        }

        return parsed.chapters;
    } catch (error) {
        console.warn("Chapter cache read failed:", error);
        return null;
    }
}

function saveChapterCache(classNumber, subjectId, chapters) {
    try {
        /* Store only lightweight chapter-list data. */
        const lightweight = chapters.map(chapter => ({
            number: chapter.number,
            title: chapter.title,
            mcqSets: Array.isArray(chapter.mcqSets)
                ? chapter.mcqSets
                : []
        }));

        localStorage.setItem(
            getChapterCacheKey(classNumber, subjectId),
            JSON.stringify({
                savedAt: Date.now(),
                chapters: lightweight
            })
        );
    } catch (error) {
        console.warn("Chapter cache save skipped:", error);
    }
}

function renderChapterRows(classNumber, subjectId, chapters) {
    const loading =
        document.getElementById("chapterLoading");

    if (!chapters.length) {
        if (loading) {
            loading.innerHTML = `
                <h2>No Chapters Found</h2>
                <p>इस subject के chapters अभी उपलब्ध नहीं हैं।</p>
            `;
        }
        return;
    }

    if (loading) {
        loading.remove();
    }

    const oldContainer =
        app.querySelector(".chapter-list");

    if (oldContainer) {
        oldContainer.remove();
    }

    const chapterContainer =
        document.createElement("div");

    chapterContainer.className = "chapter-list";

    chapters.forEach(chapter => {
        const notes = chapter.notes;
        const mcq = chapter.mcq;
        const mcqSets = Array.isArray(chapter.mcqSets)
            ? chapter.mcqSets
            : [];

        const chapterTitle =
            chapter.title ||
            notes?.title ||
            mcq?.title ||
            `Chapter ${chapter.number}`;

        const row =
            document.createElement("div");

        row.className = "chapter-item";

        const left =
            document.createElement("div");

        left.className = "chapter-name";

        left.innerHTML = `
            <strong>Chapter ${chapter.number}</strong>
            <span>${escapeHtml(chapterTitle)}</span>
        `;

        const actions =
            document.createElement("div");

        actions.className = "chapter-actions";

        const hasMCQSets = mcqSets.length > 0;

        if (hasMCQSets) {
            const mcqButton =
                document.createElement("button");

            mcqButton.className = "btn btn-green";
            mcqButton.type = "button";
            mcqButton.textContent =
                `📝 MCQ (${mcqSets.length} Set${mcqSets.length === 1 ? "" : "s"})`;

            mcqButton.onclick = function () {
                location.hash =
                    `mcq-sets/${classNumber}/${subjectId}/${chapter.number}`;
            };

            actions.appendChild(mcqButton);
        } else {
            const noMCQ = document.createElement("span");
            noMCQ.style.cssText =
                "color:#777;font-size:15px;";
            noMCQ.textContent = "MCQ अभी उपलब्ध नहीं";
            actions.appendChild(noMCQ);
        }

        row.appendChild(left);
        row.appendChild(actions);
        chapterContainer.appendChild(row);
    });

    app.appendChild(chapterContainer);
}

/* =========================================
   CHAPTER LIST
   Cache-first + background refresh.
========================================= */

async function renderChapterList(
    classNumber,
    subjectId
) {
    const subject =
        subjects.find(item => item.id === subjectId);

    if (!subject) {
        renderScience();
        return;
    }

    app.innerHTML = `
        <button
            class="back-btn"
            onclick="location.hash='class/${classNumber}'"
        >
            ← Back to Class ${classNumber}
        </button>

        <div class="page-header">
            <h1>
                ${subject.icon}
                Class ${classNumber} ${subject.name}
            </h1>
            <p>NCERT Chapters, Notes and MCQ Practice</p>
        </div>

        ${
            classNumber === 6 && subjectId === "physics"
                ? `
                    <div style="text-align:center;margin:0 0 18px 0;">
                        <a
                            class="btn btn-blue"
                            href="${COMMON_NOTES_URL}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            📖 Notes
                        </a>
                    </div>
                `
                : ""
        }

        <div id="chapterLoading" class="card">
            <h2>Loading Chapters...</h2>
            <p>Please wait.</p>
        </div>
    `;

    /* =========================================
       1) Show cached chapter list immediately.
    ========================================= */
    const cachedChapters =
        readChapterCache(classNumber, subjectId);

    if (cachedChapters && cachedChapters.length) {
        renderChapterRows(
            classNumber,
            subjectId,
            cachedChapters
        );
    }

    /* =========================================
       2) Always refresh in background so newly
          uploaded/renamed/deleted MCQs appear.
    ========================================= */
    const chapters = [];

    if (
        classNumber === 6 &&
        subjectId === "physics"
    ) {
        const chapterResults = await Promise.all(
            CLASS6_PHYSICS_CHAPTERS.map(async chapter => {
                let items = [];

                try {
                    const response = await fetch(
                        `/api/mcq-html/6/physics/${chapter.number}`,
                        { cache: "no-store" }
                    );

                    if (response.ok) {
                        const data = await response.json();
                        items = Array.isArray(data)
                            ? data
                            : (Array.isArray(data.items) ? data.items : []);
                    }
                } catch (error) {
                    console.error(
                        "MCQ HTML list load error:",
                        chapter.number,
                        error
                    );
                }

                try {
                    const jsonResponse = await fetch(
                        `/api/mcqs/6/physics/${chapter.number}`,
                        { cache: "no-store" }
                    );

                    if (jsonResponse.ok) {
                        const jsonData = await jsonResponse.json();

                        if (
                            jsonData &&
                            jsonData.success &&
                            jsonData.exists &&
                            jsonData.data &&
                            Array.isArray(jsonData.data.questions)
                        ) {
                            items.push({
                                id: "saved-json-mcq",
                                name:
                                    jsonData.data.title ||
                                    `Chapter ${chapter.number} JSON MCQ`,
                                questionCount:
                                    jsonData.data.questions.length,
                                isJSON: true,
                                url:
                                    `/#quiz/6/physics/${chapter.number}/json/direct`
                            });
                        }
                    }
                } catch (error) {
                    console.error(
                        "Saved JSON MCQ load error:",
                        chapter.number,
                        error
                    );
                }

                return {
                    number: chapter.number,
                    title: chapter.title,
                    notes: null,
                    mcqSets: items
                };
            })
        );

        chapters.push(...chapterResults);
    } else {
        const chapterNumbers = Array.from(
            { length: 100 },
            (_, index) => index + 1
        );

        const chapterResults = await Promise.all(
            chapterNumbers.map(async i => {
                const notesPath = getJSONPath(
                    classNumber,
                    subjectId,
                    i,
                    "notes"
                );

                const notesPromise = loadJSON(notesPath);

                const htmlPromise = fetch(
                    `/api/mcq-html/${classNumber}/${subjectId}/${i}`,
                    { cache: "no-store" }
                )
                    .then(async response => {
                        if (!response.ok) return [];

                        const data = await response.json();
                        return Array.isArray(data)
                            ? data
                            : (Array.isArray(data.items) ? data.items : []);
                    })
                    .catch(() => []);

                const jsonPromise = fetch(
                    `/api/mcqs/${classNumber}/${subjectId}/${i}`,
                    { cache: "no-store" }
                )
                    .then(async response => {
                        if (!response.ok) return null;

                        const result = await response.json();

                        if (
                            result &&
                            result.success &&
                            result.exists &&
                            result.data &&
                            Array.isArray(result.data.questions)
                        ) {
                            return result.data;
                        }

                        return null;
                    })
                    .catch(() => null);

                const [notesData, htmlItems, mcqData] =
                    await Promise.all([
                        notesPromise,
                        htmlPromise,
                        jsonPromise
                    ]);

                if (
                    !notesData &&
                    !mcqData &&
                    htmlItems.length === 0
                ) {
                    return null;
                }

                const jsonSet = mcqData
                    ? [{
                        id: "saved-json-mcq",
                        name:
                            mcqData.title ||
                            mcqData.chapterTitle ||
                            `Chapter ${i} JSON MCQ`,
                        questionCount:
                            Array.isArray(mcqData.questions)
                                ? mcqData.questions.length
                                : 0,
                        isJSON: true,
                        url:
                            `/#quiz/${classNumber}/${subjectId}/${i}/json/direct`
                    }]
                    : [];

                return {
                    number: i,
                    title:
                        notesData?.title ||
                        mcqData?.title ||
                        mcqData?.chapterTitle ||
                        htmlItems[0]?.name ||
                        `Chapter ${i}`,
                    notes: notesData,
                    mcq: mcqData,
                    mcqSets: [
                        ...htmlItems,
                        ...jsonSet
                    ]
                };
            })
        );

        chapterResults.forEach(chapter => {
            if (chapter) chapters.push(chapter);
        });
    }

    /* =========================================
       3) Save fresh data and replace the cached UI.
    ========================================= */
    saveChapterCache(
        classNumber,
        subjectId,
        chapters
    );

    /* Route may have changed while requests were running. */
    const currentParts =
        (window.location.hash || "#home")
            .substring(1)
            .split("/");

    if (
        currentParts[0] !== "subject" ||
        Number(currentParts[1]) !== Number(classNumber) ||
        currentParts[2] !== subjectId
    ) {
        return;
    }

    renderChapterRows(
        classNumber,
        subjectId,
        chapters
    );
}

/* =========================================
   ADMIN CACHE INVALIDATION
   Admin writes this key after upload/rename/delete.
========================================= */

window.addEventListener("storage", function (event) {
    if (event.key !== CHAPTER_CACHE_BUSTER_KEY) {
        return;
    }

    const parts =
        (window.location.hash || "#home")
            .substring(1)
            .split("/");

    if (parts[0] !== "subject") {
        return;
    }

    const classNumber = Number(parts[1]);
    const subjectId = parts[2];

    if (!classNumber || !subjectId) {
        return;
    }

    /* Cache remains visible immediately; renderChapterList
       refreshes it in the background. */
    renderChapterList(
        classNumber,
        subjectId
    );
});


/* =========================================
   MCQ SETS PAGE
   CLASS 6 PHYSICS HTML QUIZZES
========================================= */

async function renderMCQSetsPage(
    classNumber,
    subjectId,
    chapterNumber
) {

    const subject =
        subjects.find(
            item =>
                item.id === subjectId
        );

    const chapterTitle =
        `Chapter ${chapterNumber}`;

    app.innerHTML = `

        <button
            class="back-btn"
            onclick="location.hash='subject/${classNumber}/${subjectId}'"
        >
            ← Back to Chapters
        </button>

        <div class="page-header">

            <h1>
                ${subject?.icon || "📝"} MCQ Practice
            </h1>

            <p>
                Class ${classNumber} —
                ${escapeHtml(subject?.name || subjectId)}
                — Chapter ${chapterNumber}
            </p>

        </div>

        <div
            id="mcqSetsLoading"
            class="card"
        >

            <h2>
                Loading MCQ Sets...
            </h2>

            <p>
                Please wait.
            </p>

        </div>

    `;

    let items = [];

    /* =====================================
       HTML MCQ Sets — all classes/subjects
    ===================================== */

    try {

        const response =
            await fetch(
                `/api/mcq-html/${classNumber}/${subjectId}/${chapterNumber}`,
                {
                    cache: "no-store"
                }
            );

        if (response.ok) {

            const data =
                await response.json();

            items =
                Array.isArray(data)
                    ? data
                    : (
                        Array.isArray(data.items)
                            ? data.items
                            : []
                    );
        }

    } catch (error) {

        console.error(
            "MCQ Sets HTML load error:",
            error
        );
    }

    /* =====================================
       Saved JSON MCQ — all classes/subjects
    ===================================== */

    try {

        const jsonResponse =
            await fetch(
                `/api/mcqs/${classNumber}/${subjectId}/${chapterNumber}`,
                {
                    cache: "no-store"
                }
            );

        if (jsonResponse.ok) {

            const jsonData =
                await jsonResponse.json();

            if (
                jsonData &&
                jsonData.success &&
                jsonData.exists &&
                jsonData.data &&
                Array.isArray(jsonData.data.questions)
            ) {

                items.push({

                    id: "saved-json-mcq",

                    name:
                        jsonData.data.title ||
                        jsonData.data.chapterTitle ||
                        `Chapter ${chapterNumber} JSON MCQ`,

                    questionCount:
                        jsonData.data.questions.length,

                    isJSON: true,

                    url:
                        `/#quiz/${classNumber}/${subjectId}/${chapterNumber}/json/direct`

                });
            }
        }

    } catch (error) {

        console.error(
            "Saved JSON MCQ load error:",
            error
        );
    }

    const loading =
        document.getElementById(
            "mcqSetsLoading"
        );

    if (!items.length) {

        loading.innerHTML = `

            <h2>
                MCQ अभी उपलब्ध नहीं
            </h2>

            <p>
                इस chapter के लिए अभी कोई MCQ Set upload/save नहीं किया गया है।
            </p>

        `;

        return;
    }

    loading.remove();

    const container =
        document.createElement(
            "div"
        );

    container.className =
        "card-grid";

    items.forEach(
        (item, index) => {

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "card";

            const name =
                item.name ||
                item.originalName ||
                item.fileName ||
                `MCQ Set ${index + 1}`;

            const count =
                item.questionCount ??
                "—";

            card.innerHTML = `

                <div class="card-icon">
                    📝
                </div>

                <h3>
                    Set ${index + 1}
                </h3>

                <p>
                    ${escapeHtml(name)}
                </p>

                <p>
                    <strong>
                        ${escapeHtml(count)}
                    </strong>
                    Questions
                </p>

                <button
                    class="btn btn-green"
                    type="button"
                >
                    ▶ Start MCQ
                </button>

            `;

            const button =
                card.querySelector(
                    "button"
                );

            button.onclick =
                function () {

                    if (item.isJSON) {

                        location.hash =
                            `quiz/${classNumber}/${subjectId}/${chapterNumber}/json/direct`;

                        return;
                    }

                    if (!item.id) {

                        alert(
                            "MCQ Set ID nahi mila."
                        );

                        return;
                    }

                    location.hash =
                        `quiz/${classNumber}/${subjectId}/${chapterNumber}/${encodeURIComponent(item.id)}/direct`;

                };

            container.appendChild(
                card
            );

        }
    );

    app.appendChild(
        container
    );
}


/* =========================================
   NOTES PAGE
========================================= */

async function renderNotes(
    classNumber,
    subjectId,
    chapterNumber
) {

    const subject =
        subjects.find(
            item =>
                item.id === subjectId
        );


    const notesPath =
        getJSONPath(
            classNumber,
            subjectId,
            chapterNumber,
            "notes"
        );


    const notes =
        await loadJSON(
            notesPath
        );


    if (!notes) {

        app.innerHTML = `

            <button
                class="back-btn"
                onclick="location.hash='subject/${classNumber}/${subjectId}'"
            >
                ← Back to Chapters
            </button>


            <div class="card">

                <h2>
                    Notes Not Found
                </h2>


                <p>
                    इस chapter की Notes JSON file नहीं मिली।
                </p>


                <p>

                    File:

                    <strong>
                        ${escapeHtml(
                            notesPath
                        )}
                    </strong>

                </p>

            </div>

        `;

        return;
    }


    /*
       अगर Google Docs URL है,
       तो Google Docs directly open होगा.
    */

    if (
        notes.googleDocsUrl
    ) {

        window.location.href =
            notes.googleDocsUrl;

        return;
    }


    /* =================================
       LOCAL NOTES
    ================================= */

    app.innerHTML = `

        <button
            class="back-btn"
            onclick="location.hash='subject/${classNumber}/${subjectId}'"
        >
            ← Back to ${subject?.name || "Chapters"}
        </button>


        <div class="page-header">

            <h1>
                ${subject?.icon || "📘"}
                Class ${classNumber}
                ${subject?.name || ""}
            </h1>


            <p>
                Chapter ${chapterNumber}
            </p>

        </div>


        <div class="card notes-content">

            <h2>

                ${escapeHtml(
                    notes.title ||
                    `Chapter ${chapterNumber}`
                )}

            </h2>


            ${
                notes.content
                    ? notes.content
                    : "<p>Notes content available नहीं है।</p>"
            }

        </div>
    `;
}


/* =========================================
   QUIZ PAGE
========================================= */

async function renderQuizPage(
    classNumber,
    subjectId,
    chapterNumber,
    directStart = false,
    mcqSetId = null,
    forceJSON = false
) {

    const subject =
        subjects.find(
            item =>
                item.id === subjectId
        );


    app.innerHTML = `

        <button
            class="back-btn"
            onclick="location.hash='subject/${classNumber}/${subjectId}'"
        >
            ← Back to Chapters
        </button>


        <div class="page-header">

            <h1>

                ${subject?.icon || "📝"}

                ${subject?.name || "MCQ"}

                — Chapter ${chapterNumber}

            </h1>


            <p>
                NCERT MCQ Practice
            </p>

        </div>


        <div id="quizApp">

            <div class="card">

                <h2>
                    Loading Questions...
                </h2>


                <p>
                    Please wait.
                </p>

            </div>

        </div>
    `;


    /* =========================================
       LOAD MCQ

       Selected HTML Set ho to use karo.
       Warna normal loader: HTML → JSON fallback.
    ========================================= */

    let mcqData = null;

    if (forceJSON) {
        try {
            const response = await fetch(
                `/api/mcqs/${classNumber}/${subjectId}/${chapterNumber}`,
                { cache: "no-store" }
            );

            if (response.ok) {
                const result = await response.json();

                if (result && result.success && result.exists) {
                    mcqData = result.data;
                }
            }
        } catch (error) {
            console.error(
                "MCQ JSON API Load Error:",
                error
            );
        }
    }

    if (
        !mcqData &&
        mcqSetId
    ) {

        try {

            const response =
                await fetch(
                    `/api/mcq-html/${classNumber}/${subjectId}/${chapterNumber}`,
                    { cache: "no-store" }
                );

            if (response.ok) {

                const data =
                    await response.json();

                const items =
                    Array.isArray(data)
                        ? data
                        : (Array.isArray(data.items) ? data.items : []);

                const selectedItem =
                    items.find(
                        item =>
                            String(item.id) === String(mcqSetId)
                    );

                if (
                    selectedItem &&
                    selectedItem.url
                ) {

                    mcqData =
                        await loadMCQHTML(
                            selectedItem.url
                        );
                }
            }

        } catch (error) {

            console.error(
                "Selected MCQ Set load error:",
                error
            );
        }
    }

    if (!mcqData) {

        mcqData =
            await loadMCQData(
                classNumber,
                subjectId,
                chapterNumber
            );
    }


    const mcqPath =
        forceJSON
            ? `/api/mcqs/${classNumber}/${subjectId}/${chapterNumber}`
            : (
                classNumber === 6 &&
                subjectId === "physics"
                    ? getMCQHTMLPath(
                        classNumber,
                        subjectId,
                        chapterNumber
                    ) +
                      " OR " +
                      getJSONPath(
                        classNumber,
                        subjectId,
                        chapterNumber,
                        "mcq"
                    )
                    : getJSONPath(
                        classNumber,
                        subjectId,
                        chapterNumber,
                        "mcq"
                    )
            );


    if (!mcqData) {

        document.getElementById(
            "quizApp"
        ).innerHTML = `

            <div class="card">

                <h2>
                    No Questions
                </h2>


                <p>
                    इस chapter में अभी questions उपलब्ध नहीं हैं।
                </p>


                <p>

                    File:

                    <strong>
                        ${escapeHtml(
                            mcqPath
                        )}
                    </strong>

                </p>

            </div>
        `;

        return;
    }


    /* =================================
       INITIALIZE QUIZ SYSTEM
    ================================= */

    if (
        typeof initializeQuizSystem ===
        "function"
    ) {

        initializeQuizSystem(

            mcqData,

            classNumber,

            subjectId,

            chapterNumber,

            directStart

        );

    }

    else {

        console.error(
            "quiz.js not loaded"
        );


        document.getElementById(
            "quizApp"
        ).innerHTML = `

            <div class="card">

                <h2>
                    Quiz System Error
                </h2>


                <p>
                    quiz.js load नहीं हुआ।
                </p>

            </div>

        `;
    }
}


/* =========================================
   EVENTS
========================================= */

window.addEventListener(
    "hashchange",
    router
);


window.addEventListener(
    "DOMContentLoaded",
    router
);