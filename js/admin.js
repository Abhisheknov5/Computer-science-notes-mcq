"use strict";

/*
========================================================
 NCERT GK-GS NOTES + MCQ ADMIN
 ONE PAGE ADMIN
 Existing MCQ APIs preserved.
 Quiz files are not modified.
========================================================
*/

let currentSubject = "Physics";
let currentClass = 6;
let currentChapter = null;

let importedQuestions = [];
let importedData = null;

const subjectIdMap = {
    "Physics": "physics",
    "Chemistry": "chemistry",
    "Biology": "biology",
    "Environmental-Science": "environmental-science",
    "History": "history",
    "Geography": "geography",
    "Political-Science": "political-science",
    "Economics": "economics"
};

function getElement(id) {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`HTML में "${id}" element नहीं मिला।`);
    }

    return element;
}

function showMessage(elementId, text, type) {
    const box = getElement(elementId);
    box.textContent = text;
    box.className = "message " + type;
    box.style.display = "block";
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeJS(value) {
    return String(value)
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r");
}

/* ======================================================
   ONE PAGE SELECTION
====================================================== */

function selectSubject(subject) {
    currentSubject = subject;

    document.querySelectorAll(".subject-card").forEach(function (card) {
        card.classList.toggle(
            "active",
            card.dataset.subject === subject
        );
    });

    getElement("currentSubjectTitle").textContent =
        subject === "Environmental-Science"
            ? "Environmental Science"
            : subject;

    updateSelectionUI();
    loadQuizzes();
}

function updateSelectionUI() {
    currentClass = Number(getElement("classNumber").value);

    const chapterValue = getElement("chapterNumber").value.trim();
    currentChapter = chapterValue ? Number(chapterValue) : null;

    const chapterText = currentChapter && currentChapter > 0
        ? currentChapter
        : "—";

    getElement("selectionBadge").textContent =
        `Class ${currentClass} • Chapter ${chapterText}`;

    getElement("uploadClassText").textContent = currentClass;

    getElement("uploadSubjectText").textContent =
        currentSubject === "Environmental-Science"
            ? "Environmental Science"
            : currentSubject;

    getElement("uploadChapterText").textContent = chapterText;

    getElement("listDescription").textContent =
        `${currentSubject === "Environmental-Science" ? "Environmental Science" : currentSubject} • Class ${currentClass} • Chapter ${chapterText}`;
}

getElement("classNumber").addEventListener("change", function () {
    currentClass = Number(this.value);
    updateSelectionUI();
    loadQuizzes();
});

getElement("chapterNumber").addEventListener("input", function () {
    const value = this.value.trim();

    currentChapter = value ? Number(value) : null;
    updateSelectionUI();
});

getElement("mcqFile").addEventListener("change", function () {
    const file = this.files[0];

    getElement("htmlFileName").textContent =
        file ? file.name : "No file selected";
});

getElement("jsonFile").addEventListener("change", function () {
    const file = this.files[0];

    if (!file) {
        getElement("fileName").textContent =
            "Koi JSON file select nahi ki gayi";
        return;
    }

    if (!file.name.toLowerCase().endsWith(".json")) {
        this.value = "";
        getElement("fileName").textContent =
            "Koi JSON file select nahi ki gayi";
        alert("❌ केवल JSON file select करें।");
        return;
    }

    getElement("fileName").textContent =
        `Selected: ${file.name}`;
});

/* ======================================================
   LOGIN
====================================================== */

async function checkLogin() {
    try {
        const response = await fetch("/api/owner/status");
        const data = await response.json();

        if (data && data.authenticated) {
            getElement("loginCard").classList.add("hidden");
            getElement("adminPanel").classList.remove("hidden");
            updateSelectionUI();
            loadQuizzes();
        }
    } catch (error) {
        console.error("Login status error:", error);
    }
}

async function login() {
    const password = getElement("password").value.trim();

    if (!password) {
        showMessage("loginMessage", "Password daaliye.", "error");
        return;
    }

    try {
        const response = await fetch("/api/owner/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (!response.ok) {
            showMessage(
                "loginMessage",
                data.message || "Login failed.",
                "error"
            );
            return;
        }

        getElement("loginCard").classList.add("hidden");
        getElement("adminPanel").classList.remove("hidden");
        getElement("password").value = "";

        updateSelectionUI();
        loadQuizzes();
    } catch (error) {
        showMessage(
            "loginMessage",
            "Server se connection nahi ho raha.",
            "error"
        );
    }
}

async function logout() {
    try {
        await fetch("/api/owner/logout", {
            method: "POST"
        });
    } catch (error) {
        console.error(error);
    }

    getElement("adminPanel").classList.add("hidden");
    getElement("loginCard").classList.remove("hidden");
}

/* ======================================================
   MCQ HTML LIST
====================================================== */

function getManagementInputs() {
    const classNumber = Number(getElement("classNumber").value);
    const chapterNumber = Number(getElement("chapterNumber").value);

    if (classNumber < 6 || classNumber > 12) {
        throw new Error("Class 6 से 12 के बीच होनी चाहिए।");
    }

    if (!chapterNumber || chapterNumber < 1) {
        throw new Error("Chapter Number डालें।");
    }

    currentClass = classNumber;
    currentChapter = chapterNumber;

    return {
        classNumber,
        subject: subjectIdMap[currentSubject],
        chapterNumber
    };
}

async function loadQuizzes() {
    let inputs;

    try {
        inputs = getManagementInputs();
    } catch (error) {
        getElement("quizList").innerHTML = `<div class="empty">${escapeHTML(error.message)}</div>`;
        getElement("mcqCountBadge").textContent = "0 MCQ Sets";
        return;
    }

    updateSelectionUI();
    const list = getElement("quizList");
    list.innerHTML = "<div class='empty'>Loading...</div>";

    try {
        const subjectId = subjectIdMap[currentSubject];
        const htmlResponse = await fetch(`/api/mcq-html/${inputs.classNumber}/${inputs.subject}/${inputs.chapterNumber}`);
        const htmlData = await htmlResponse.json();
        let htmlItems = htmlResponse.ok ? (Array.isArray(htmlData) ? htmlData : (htmlData.items || [])) : [];

        let jsonItem = null;
        try {
            const jsonResponse = await fetch(`/api/mcqs/${inputs.classNumber}/${subjectId}/${inputs.chapterNumber}`, { cache: "no-store" });
            if (jsonResponse.ok) {
                const jsonData = await jsonResponse.json();
                if (jsonData?.success && jsonData?.exists && jsonData?.data && Array.isArray(jsonData.data.questions)) {
                    jsonItem = {
                        id: "saved-json-mcq",
                        name: jsonData.data.title || `Chapter ${inputs.chapterNumber} JSON MCQ`,
                        questionCount: jsonData.data.questions.length,
                        isJSON: true,
                        url: `/#quiz/${inputs.classNumber}/${subjectId}/${inputs.chapterNumber}/json/direct`
                    };
                }
            }
        } catch (jsonError) {
            console.error("Saved JSON MCQ load error:", jsonError);
        }

        const items = [...htmlItems];
        if (jsonItem) items.push(jsonItem);

        getElement("mcqCountBadge").textContent = `${items.length} MCQ Set${items.length === 1 ? "" : "s"}`;

        if (items.length === 0) {
            list.innerHTML = "<div class='empty'>Is chapter me abhi koi MCQ upload/save nahi hai.</div>";
            return;
        }

        list.innerHTML = "";
        items.forEach(function (item) {
            const div = document.createElement("div");
            div.className = "quiz-item";
            const name = item.name || item.originalName || item.filename || "MCQ Quiz";
            const count = item.questionCount ?? item.questions ?? "—";
            const jsonLabel = item.isJSON ? " 💾 JSON" : "";
            div.innerHTML = `
                <div class="quiz-name">${escapeHTML(name)}${jsonLabel}</div>
                <div class="quiz-info">Questions: ${escapeHTML(count)}</div>
                <div class="actions">
                    <a class="open-btn" href="${escapeHTML(item.url || "#")}" target="_blank" rel="noopener">▶ Open Quiz</a>
                    <button class="rename-btn" onclick="${item.isJSON ? `renameJSONQuiz('${escapeJS(name)}')` : `renameQuiz('${escapeJS(item.id)}', '${escapeJS(name)}')`}">✏ Rename</button>
                    <button class="delete-btn" onclick="${item.isJSON ? `deleteJSONQuiz()` : `deleteQuiz('${escapeJS(item.id)}')`}">🗑 Delete</button>
                </div>`;
            list.appendChild(div);
        });
    } catch (error) {
        console.error(error);
        list.innerHTML = "<div class='empty'>Server error.</div>";
        getElement("mcqCountBadge").textContent = "0 MCQ Sets";
    }
}

/* ======================================================
   HTML MCQ UPLOAD
====================================================== */

async function uploadMCQ() {
    let inputs;

    try {
        inputs = getManagementInputs();
    } catch (error) {
        showMessage("uploadMessage", error.message, "error");
        return;
    }

    const fileInput = getElement("mcqFile");
    const file = fileInput.files[0];

    if (!file) {
        showMessage(
            "uploadMessage",
            "Pehle HTML file select karo.",
            "error"
        );
        return;
    }

    const lowerName = file.name.toLowerCase();

    if (
        !lowerName.endsWith(".html") &&
        !lowerName.endsWith(".htm")
    ) {
        showMessage(
            "uploadMessage",
            "Sirf HTML file upload karo.",
            "error"
        );
        return;
    }

    const formData = new FormData();

    formData.append("mcqFile", file);
    formData.append("classNumber", String(inputs.classNumber));
    formData.append("subject", inputs.subject);
    formData.append("chapterNumber", String(inputs.chapterNumber));

    try {
        showMessage(
            "uploadMessage",
            "Uploading...",
            "success"
        );

        const response = await fetch(
            "/api/mcq-html/upload",
            {
                method: "POST",
                body: formData
            }
        );

        const data = await response.json();

        if (!response.ok) {
            showMessage(
                "uploadMessage",
                data.message ||
                data.error ||
                "Upload failed.",
                "error"
            );
            return;
        }

        showMessage(
            "uploadMessage",
            "✅ MCQ successfully upload ho gaya.",
            "success"
        );

        fileInput.value = "";
        getElement("htmlFileName").textContent = "No file selected";

        loadQuizzes();
    } catch (error) {
        console.error(error);

        showMessage(
            "uploadMessage",
            "Server error. Upload nahi hua.",
            "error"
        );
    }
}

/* ======================================================
   RENAME
====================================================== */

async function renameQuiz(id, oldName) {
    let inputs;

    try {
        inputs = getManagementInputs();
    } catch (error) {
        alert(error.message);
        return;
    }

    const newName = prompt(
        "Naya quiz name daaliye:",
        oldName
    );

    if (!newName || !newName.trim()) {
        return;
    }

    try {
        const response = await fetch(
            "/api/mcq-html/rename",
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    classNumber: inputs.classNumber,
                    subject: inputs.subject,
                    chapterNumber: inputs.chapterNumber,
                    id,
                    newName: newName.trim()
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            alert(
                data.message ||
                data.error ||
                "Rename failed."
            );
            return;
        }

        loadQuizzes();
    } catch (error) {
        console.error(error);
        alert("Server error.");
    }
}

/* ======================================================
   DELETE
====================================================== */

async function deleteQuiz(id) {
    let inputs;

    try {
        inputs = getManagementInputs();
    } catch (error) {
        alert(error.message);
        return;
    }

    const confirmDelete = confirm(
        "Kya aap is MCQ ko delete karna chahte hain?"
    );

    if (!confirmDelete) {
        return;
    }

    try {
        const response = await fetch(
            "/api/mcq-html",
            {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    classNumber: inputs.classNumber,
                    subject: inputs.subject,
                    chapterNumber: inputs.chapterNumber,
                    id
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            alert(
                data.message ||
                data.error ||
                "Delete failed."
            );
            return;
        }

        loadQuizzes();
    } catch (error) {
        console.error(error);
        alert("Server error.");
    }
}

/* ======================================================
   JSON RENAME / DELETE
====================================================== */

async function renameJSONQuiz(oldName) {
    let inputs;

    try {
        inputs = getManagementInputs();
    } catch (error) {
        alert(error.message);
        return;
    }

    const newName = prompt("Naya MCQ name daaliye:", oldName);

    if (!newName || !newName.trim()) return;

    try {
        const response = await fetch("/api/mcqs/rename", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                classNumber: inputs.classNumber,
                subject: inputs.subject,
                chapterNumber: inputs.chapterNumber,
                newName: newName.trim()
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            alert(data.message || data.error || "JSON MCQ rename failed.");
            return;
        }

        loadQuizzes();
    } catch (error) {
        console.error("JSON rename error:", error);
        alert("Server error.");
    }
}

async function deleteJSONQuiz() {
    let inputs;

    try {
        inputs = getManagementInputs();
    } catch (error) {
        alert(error.message);
        return;
    }

    if (!confirm("Kya aap is saved JSON MCQ ko delete karna chahte hain?")) {
        return;
    }

    try {
        const response = await fetch("/api/mcqs/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                classNumber: inputs.classNumber,
                subject: inputs.subject,
                chapterNumber: inputs.chapterNumber
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            alert(
                data.message ||
                data.error ||
                `JSON MCQ delete failed. HTTP ${response.status}`
            );
            return;
        }

        alert("✅ JSON MCQ delete ho gaya.");
        loadQuizzes();
    } catch (error) {
        console.error("JSON delete error:", error);
        alert("Server error.");
    }
}

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
    if (number >= 126 && number <= 150) return "E";
    return "";
}

function getInputs() {
    const classNumber = Number(getElement("classNumber").value);
    const chapterNumber = Number(getElement("chapterNumber").value);
    const chapterTitle = getElement("chapterTitle").value.trim();
    const jsonFile = getElement("jsonFile").files[0];

    if (classNumber < 6 || classNumber > 12) {
        throw new Error("Class 6 से 12 के बीच होनी चाहिए।");
    }

    if (!chapterNumber || chapterNumber < 1) {
        throw new Error("Chapter Number invalid है।");
    }

    if (!chapterTitle) {
        throw new Error("Chapter Title डालें।");
    }

    if (!jsonFile) {
        throw new Error("पहले MCQ JSON file upload करें।");
    }

    if (!jsonFile.name.toLowerCase().endsWith(".json")) {
        throw new Error("केवल JSON file upload करें।");
    }

    return {
        classNumber,
        subject: currentSubject,
        chapterNumber,
        chapterTitle,
        jsonFile
    };
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

    if (questions.length !== 150) {
        throw new Error(
            `Exactly 150 MCQs required हैं। मिले: ${questions.length}`
        );
    }

    return questions.map(function (question, index) {
        return cleanQuestion(question, index);
    });
}

function createOutputData(inputs, questions) {
    return {
        chapterTitle: inputs.chapterTitle,
        classNumber: inputs.classNumber,
        subject: inputs.subject,
        chapterNumber: inputs.chapterNumber,
        title: inputs.chapterTitle,
        class: inputs.classNumber,
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
            <strong>✅ Exactly 150 MCQs Validated</strong>
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
            "✅ सभी 150 MCQs validate हो गए।";

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
            "🎉 Exactly 150 MCQs successfully imported!";

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

getElement("importBtn").addEventListener(
    "click",
    importMCQs
);

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
            "/api/save-mcqs",
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
            "✅ 150 MCQs permanently save हो गए!";

        getElement("resultCard").classList.remove("hidden");

        getElement("resultText").innerHTML = `
            <div class="status-row">
                <strong>✅ 150 MCQs Saved Successfully</strong>
                <br><br>
                📁 File:
                ${escapeHTML(
                    result.fileName ||
                    `chapter-${String(importedData.chapterNumber).padStart(2, "0")}.json`
                )}
                <br><br>
                📚 Class: ${importedData.classNumber}
                <br>
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
            `/#quiz/${importedData.classNumber}/${subjectId}/${importedData.chapterNumber}/json/direct`;

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

getElement("saveQuizBtn").addEventListener(
    "click",
    savePermanently
);

/* ======================================================
   COPY JSON
====================================================== */

getElement("copyBtn").addEventListener(
    "click",
    async function () {
        const text = getElement("jsonPreview").value.trim();

        if (!text) {
            alert("पहले MCQs import करें।");
            return;
        }

        try {
            await navigator.clipboard.writeText(text);

            this.textContent = "✓ Copied";

            setTimeout(() => {
                this.textContent = "📋 Copy JSON";
            }, 1500);
        } catch {
            getElement("jsonPreview").select();
            document.execCommand("copy");
            alert("JSON copied.");
        }
    }
);

/* ======================================================
   DOWNLOAD JSON
====================================================== */

getElement("downloadBtn").addEventListener(
    "click",
    function () {
        const text = getElement("jsonPreview").value.trim();

        if (!text) {
            alert("पहले MCQs import करें।");
            return;
        }

        let data;

        try {
            data = JSON.parse(text);
        } catch {
            alert("JSON invalid है।");
            return;
        }

        const chapterNumber =
            Number(data.chapterNumber || data.chapter);

        const filename =
            `chapter-${String(chapterNumber).padStart(2, "0")}.json`;

        const blob = new Blob(
            [JSON.stringify(data, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    }
);

/* ======================================================
   START
====================================================== */

updateSelectionUI();
checkLogin();

console.log("NCERT Admin — One Page Loaded");

