/* =========================================
   NCERT MCQ QUIZ SYSTEM
   FULL JSON BASED VERSION
========================================= */

let allQuizQuestions = [];
let quizQuestions = [];

let current = 0;

let selectedAnswers = [];
let checked = [];

let quizData = null;

let quizClass = null;
let quizSubject = null;
let quizChapter = null;

let selectedSection = null;
let reviewMode = false;


/* =========================================
   SECTION DEFINITIONS
========================================= */

const sectionDefinitions = [

    {
        id: "A",
        name: "Section A — Basic / Direct NCERT Questions",
        start: 1,
        end: 35
    },

    {
        id: "B",
        name: "Section B — Concept Based Questions",
        start: 36,
        end: 70
    },

    {
        id: "C",
        name: "Section C — Statement Based Questions",
        start: 71,
        end: 105
    },

    {
        id: "D",
        name: "Section D — Assertion–Reason Questions",
        start: 106,
        end: 125
    },

    {
        id: "E",
        name: "Section E — Case / Scenario Based Questions",
        start: 126,
        end: 150
    }

];


/* =========================================
   HTML ESCAPE
========================================= */

function quizEscape(value) {

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
   ANSWER NORMALIZER
========================================= */

function normalizeAnswer(answer) {

    if (typeof answer === "number") {
        return answer;
    }

    if (typeof answer === "string") {

        const value =
            answer.trim().toUpperCase();

        if (/^[A-E]$/.test(value)) {

            return (
                value.charCodeAt(0) -
                "A".charCodeAt(0)
            );

        }

        const number =
            Number(value);

        if (!Number.isNaN(number)) {

            return number;

        }

    }

    return -1;
}


/* =========================================
   EXTRACT QUESTIONS
========================================= */

function extractQuestions(data) {

    if (Array.isArray(data)) {

        return data;

    }

    if (
        data &&
        Array.isArray(data.questions)
    ) {

        return data.questions;

    }

    if (
        data &&
        Array.isArray(data.mcqs)
    ) {

        return data.mcqs;

    }

    return [];
}


/* =========================================
   QUESTION ID
========================================= */

function getQuestionId(question, index) {

    if (
        question &&
        question.id !== undefined
    ) {

        return Number(question.id);

    }

    return index + 1;
}


/* =========================================
   GET SECTION
========================================= */

function getSectionForQuestion(
    question,
    index
) {

    const id =
        getQuestionId(
            question,
            index
        );

    const explicit =
        question?.section ||
        question?.sectionId ||
        question?.sectionName ||
        "";

    if (typeof explicit === "string") {

        const value =
            explicit
                .trim()
                .toUpperCase();

        if (
            value === "A" ||
            value.includes("SECTION A")
        ) {

            return sectionDefinitions[0];

        }

        if (
            value === "B" ||
            value.includes("SECTION B")
        ) {

            return sectionDefinitions[1];

        }

        if (
            value === "C" ||
            value.includes("SECTION C")
        ) {

            return sectionDefinitions[2];

        }

        if (
            value === "D" ||
            value.includes("SECTION D")
        ) {

            return sectionDefinitions[3];

        }

        if (
            value === "E" ||
            value.includes("SECTION E")
        ) {

            return sectionDefinitions[4];

        }

    }

    for (
        const section of sectionDefinitions
    ) {

        if (
            id >= section.start &&
            id <= section.end
        ) {

            return section;

        }

    }

    return null;
}


/* =========================================
   GET SECTION QUESTIONS
========================================= */

function getSectionQuestions(section) {

    /*
       FULL QUIZ
       A + B + C + D + E
       All questions in original order
    */

    if (
        section &&
        section.id === "ALL"
    ) {

        return allQuizQuestions.slice();

    }

    return allQuizQuestions.filter(
        (question, index) => {

            const id =
                getQuestionId(
                    question,
                    index
                );

            return (
                id >= section.start &&
                id <= section.end
            );

        }
    );
}


/* =========================================
   QUIZ LAYOUT / UI FIXES
========================================= */

function injectQuizLayoutStyles() {

    if (
        document.getElementById(
            "quizLayoutFixStyles"
        )
    ) {
        return;
    }


    const style =
        document.createElement(
            "style"
        );

    style.id =
        "quizLayoutFixStyles";


    style.textContent = `

        /* Full Quiz card */

        .quiz-sections .section {
            display: block;
            width: 100%;
            text-align: left;
            font: inherit;
            cursor: pointer;
            box-sizing: border-box;
        }

        .full-quiz-section {
            border: 2px solid #2563eb !important;
        }


        /* Back button */

        .quiz-back-row {
            margin: 0 0 12px 0;
        }


        /* Desktop: question left + palette right */

        .quiz-layout {
            display: grid;
            grid-template-columns:
                minmax(0, 1fr)
                minmax(280px, 330px);
            gap: 20px;
            align-items: start;
        }


        .quiz-main-column {
            min-width: 0;
        }


        .quiz-side-column {
            min-width: 0;
            position: sticky;
            top: 16px;
        }


        .quiz-side-column .palette {
            margin-top: 0;
        }


        .quiz-restart-card {
            margin-top: 12px;
        }


        /* Palette */

        .quiz-side-column .pal-grid {
            display: grid;
            grid-template-columns:
                repeat(5, minmax(0, 1fr));
            gap: 8px;
            max-height: 430px;
            overflow-y: auto;
            padding-right: 3px;
        }


        .quiz-side-column .pal {
            min-width: 0;
            min-height: 38px;
        }


        /* Attempted = GREEN */

        .quiz-side-column .pal.answered {
            background: #16a34a !important;
            color: #ffffff !important;
            border-color: #16a34a !important;
        }


        /* Current unanswered = BLUE */

        .quiz-side-column .pal.current {
            background: #2563eb !important;
            color: #ffffff !important;
            border-color: #2563eb !important;
        }


        /* Keep answered green even after clicking it */

        .quiz-side-column .pal.answered.current {
            background: #16a34a !important;
            color: #ffffff !important;
            border-color: #16a34a !important;
        }


        @media (max-width: 900px) {

            .quiz-layout {
                grid-template-columns: 1fr;
            }

            .quiz-side-column {
                position: static;
            }

            .quiz-side-column .pal-grid {
                max-height: none;
            }

        }

    `;


    document.head.appendChild(
        style
    );
}


/* =========================================
   INITIALIZE QUIZ
========================================= */

function initializeQuizSystem(
    data,
    classNumber,
    subjectId,
    chapterNumber
) {

    injectQuizLayoutStyles();

    quizData = data;

    quizClass = classNumber;

    quizSubject = subjectId;

    quizChapter = chapterNumber;

    allQuizQuestions =
        extractQuestions(data);

    if (
        !allQuizQuestions.length
    ) {

        document.getElementById(
            "quizApp"
        ).innerHTML = `

            <div class="card">

                <h2>
                    No Questions
                </h2>

                <p>
                    इस chapter के JSON में
                    questions नहीं मिले।
                </p>

            </div>

        `;

        return;

    }

    renderQuizHome();
}


/* =========================================
   GET CHAPTER TITLE
========================================= */

function getChapterTitle() {

    if (
        quizData &&
        !Array.isArray(quizData) &&
        quizData.title
    ) {

        return quizData.title;

    }

    return `Chapter ${quizChapter}`;
}


/* =========================================
   QUIZ HOME
========================================= */

function renderQuizHome() {

    const quizApp =
        document.getElementById(
            "quizApp"
        );

    const availableSections =
        sectionDefinitions
            .map(section => {

                const questions =
                    getSectionQuestions(
                        section
                    );

                return {

                    ...section,

                    count:
                        questions.length

                };

            })
            .filter(
                section =>
                    section.count > 0
            );

    quizApp.innerHTML = `

        <section id="quizHome">

            <div class="card quiz-title-card">

                <h2>
                    📝
                    ${quizEscape(
                        getChapterTitle()
                    )}
                    MCQ Practice
                </h2>

                <p>
                    Class ${quizClass}
                    •
                    ${allQuizQuestions.length}
                    MCQs
                    •
                    ${availableSections.length}
                    Sections
                </p>

            </div>


            <div class="quiz-sections">

                <!-- FULL QUIZ — ALWAYS VISIBLE AT THE TOP -->

                <button
                    type="button"
                    class="section full-quiz-section"
                    id="fullQuizButton"
                >

                    <div
                        class="section-title"
                    >
                        📝 Full Quiz — All Questions
                    </div>

                    <div
                        class="section-count"
                    >
                        ${allQuizQuestions.length}
                        Questions
                    </div>

                </button>


                ${
                    availableSections
                        .map(
                            section => `

                        <button
                            type="button"
                            class="section"
                            data-section-id="${section.id}"
                        >

                            <div
                                class="section-title"
                            >
                                ${quizEscape(
                                    section.name
                                )}
                            </div>

                            <div
                                class="section-count"
                            >
                                ${section.count}
                                Questions
                            </div>

                        </button>

                    `
                        )
                        .join("")
                }

            </div>

        </section>


        <section
            id="quizSetup"
            class="card hidden"
        >

            <button
                class="prev"
                onclick="backToSections()"
            >
                ← Back to Sections
            </button>


            <h2 id="setupTitle"></h2>


            <p id="setupInfo"></p>


            <div
                class="quiz-setup-row"
            >

                <label
                    for="questionCount"
                >

                    <b>
                        Questions:
                    </b>

                </label>


                <select
                    id="questionCount"
                ></select>


                <button
                    class="btn"
                    onclick="startQuiz()"
                >
                    🚀 Start Practice
                </button>

            </div>

        </section>


        <section
            id="quizScreen"
            class="hidden"
        >

            <div class="quiz-back-row">

                <button
                    type="button"
                    class="prev quiz-back-btn"
                    onclick="backFromQuiz()"
                >
                    ← Back to Sections
                </button>

            </div>


            <div
                class="card quiz-header"
            >

                <strong
                    id="sectionName"
                ></strong>


                <span
                    id="counter"
                ></span>


                <span
                    id="attempted"
                ></span>

            </div>


            <div class="quiz-layout">

                <div class="quiz-main-column">

                    <div class="card">

                        <div
                            id="question"
                            class="question"
                        ></div>


                        <div
                            id="feedback"
                            class="feedback"
                        ></div>


                        <div
                            id="explanation"
                            class="explanation hidden"
                        ></div>

                    </div>


                    <div
                        class="card quiz-controls"
                    >

                        <div>

                            <button
                                type="button"
                                class="prev"
                                id="prevBtn"
                                onclick="prevQuestion()"
                            >
                                ← Previous
                            </button>


                            <button
                                type="button"
                                class="submit"
                                id="checkBtn"
                                onclick="checkAnswer()"
                            >
                                Check Answer
                            </button>


                            <button
                                type="button"
                                class="next"
                                id="nextBtn"
                                onclick="nextQuestion()"
                            >
                                Next →
                            </button>

                        </div>


                        <button
                            type="button"
                            class="submit"
                            id="submitBtn"
                            onclick="submitQuiz()"
                        >
                            Submit Test
                        </button>

                    </div>

                </div>


                <aside class="quiz-side-column">

                    <div
                        class="card palette"
                    >

                        <h3>
                            Question Palette
                        </h3>


                        <div
                            id="palette"
                            class="pal-grid"
                        ></div>

                    </div>


                    <div class="card quiz-restart-card">

                        <button
                            type="button"
                            class="prev"
                            onclick="restartQuiz()"
                        >
                            ↻ Restart
                        </button>

                    </div>

                </aside>

            </div>

        </section>


        <section
            id="quizResult"
            class="card result hidden"
        >

            <h2>
                🎯 Test Result
            </h2>


            <div
                id="resultText"
                class="stat"
            ></div>


            <br>


            <button
                class="next"
                onclick="reviewAnswers()"
            >
                👁️ Review Answers
            </button>


            <button
                class="prev"
                onclick="renderQuizHome()"
            >
                ← Back to Chapters
            </button>

        </section>

    `;


    /* =====================================
       HOME BUTTON EVENTS
       Use addEventListener instead of inline
       onclick so the buttons always work.
    ===================================== */

    const fullQuizButton =
        document.getElementById(
            "fullQuizButton"
        );

    if (fullQuizButton) {

        fullQuizButton.addEventListener(
            "click",
            openFullQuiz
        );

    }


    quizApp
        .querySelectorAll(
            "[data-section-id]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                function () {

                    openSectionSetup(
                        this.dataset.sectionId
                    );

                }
            );

        });
}


/* =========================================
   FULL QUIZ — ALL QUESTIONS
========================================= */

function openFullQuiz() {

    selectedSection = {

        id: "ALL",

        name: "Full Quiz — All Questions",

        start: 1,

        end: allQuizQuestions.length

    };

    const list =
        getSectionQuestions(
            selectedSection
        );

    document.getElementById(
        "quizHome"
    ).classList.add("hidden");

    document.getElementById(
        "quizScreen"
    ).classList.add("hidden");

    document.getElementById(
        "quizResult"
    ).classList.add("hidden");

    document.getElementById(
        "quizSetup"
    ).classList.remove("hidden");

    document.getElementById(
        "setupTitle"
    ).textContent =
        selectedSection.name;

    document.getElementById(
        "setupInfo"
    ).textContent =
        `${list.length} MCQs available`;

    const select =
        document.getElementById(
            "questionCount"
        );

    select.innerHTML = "";

    const counts = [
        5,
        10,
        20,
        list.length
    ];

    [
        ...new Set(counts)
    ]
        .filter(
            count =>
                count > 0 &&
                count <= list.length
        )
        .forEach(
            count => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    count;

                option.textContent =
                    count === list.length
                        ? `All ${count} Questions`
                        : `${count} Questions`;

                select.appendChild(
                    option
                );

            }
        );

    select.value =
        String(list.length);

    window.scrollTo(
        0,
        0
    );
}


/* =========================================
   OPEN SECTION
========================================= */

function openSectionSetup(
    sectionId
) {

    selectedSection =
        sectionDefinitions.find(
            section =>
                section.id === sectionId
        );

    if (!selectedSection) {
        return;
    }

    const list =
        getSectionQuestions(
            selectedSection
        );

    document.getElementById(
        "quizHome"
    ).classList.add("hidden");

    document.getElementById(
        "quizScreen"
    ).classList.add("hidden");

    document.getElementById(
        "quizResult"
    ).classList.add("hidden");

    document.getElementById(
        "quizSetup"
    ).classList.remove("hidden");

    document.getElementById(
        "setupTitle"
    ).textContent =
        selectedSection.name;

    document.getElementById(
        "setupInfo"
    ).textContent =
        `${list.length} MCQs available`;

    const select =
        document.getElementById(
            "questionCount"
        );

    select.innerHTML = "";

    const counts = [
        5,
        10,
        20,
        list.length
    ];

    [
        ...new Set(counts)
    ]
        .filter(
            count =>
                count > 0 &&
                count <= list.length
        )
        .forEach(
            count => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    count;

                option.textContent =
                    count === list.length
                        ? `All ${count} Questions`
                        : `${count} Questions`;

                select.appendChild(
                    option
                );

            }
        );

    /* Default = ALL */

    select.value =
        String(list.length);

    window.scrollTo(
        0,
        0
    );
}


/* =========================================
   BACK TO SECTIONS
========================================= */

function backToSections() {

    document.getElementById(
        "quizSetup"
    ).classList.add("hidden");

    document.getElementById(
        "quizHome"
    ).classList.remove("hidden");

    selectedSection = null;

    window.scrollTo(
        0,
        0
    );
}


/* =========================================
   START QUIZ
========================================= */

function startQuiz() {

    if (!selectedSection) {
        return;
    }

    const sectionQuestions =
        getSectionQuestions(
            selectedSection
        );

    const countElement =
        document.getElementById(
            "questionCount"
        );

    let count =
        Number(
            countElement?.value
        );

    if (
        !count ||
        count <= 0
    ) {

        count =
            sectionQuestions.length;

    }

    /*
       IMPORTANT:
       Questions are NOT shuffled.
       Original JSON order is preserved.
    */

    quizQuestions =
        sectionQuestions.slice(
            0,
            count
        );

    current = 0;

    selectedAnswers =
        new Array(
            quizQuestions.length
        ).fill(null);

    checked =
        new Array(
            quizQuestions.length
        ).fill(false);

    reviewMode = false;

    document.getElementById(
        "quizSetup"
    ).classList.add("hidden");

    document.getElementById(
        "quizHome"
    ).classList.add("hidden");

    document.getElementById(
        "quizResult"
    ).classList.add("hidden");

    document.getElementById(
        "quizScreen"
    ).classList.remove("hidden");

    renderQuizQuestion();

    const restartButton =
        document.getElementById(
            "restartQuizBtn"
        );

    if (restartButton) {

        restartButton.onclick =
            function () {

                restartQuiz();

            };

    }

    window.scrollTo(
        0,
        0
    );
}
/* =========================================
   RENDER QUESTION
========================================= */

function renderQuizQuestion() {

    if (
        !quizQuestions.length
    ) {
        return;
    }

    const q =
        quizQuestions[current];

    const questionText =
        q.question ??
        q.q ??
        "";

    const options =
        Array.isArray(q.options)
            ? q.options
            : [];

    document.getElementById(
        "counter"
    ).textContent =
        `Question ${current + 1} of ${quizQuestions.length}`;

    document.getElementById(
        "sectionName"
    ).textContent =
        selectedSection?.name ||
        "MCQ Practice";

    document.getElementById(
        "attempted"
    ).textContent =
        `Attempted: ${
            selectedAnswers.filter(
                answer =>
                    answer !== null
            ).length
        }/${quizQuestions.length}`;

    let html = `

        <div class="q-number">

            Q${quizEscape(
                getQuestionId(
                    q,
                    current
                )
            )}

        </div>


        <div class="question-text">

            ${quizEscape(
                questionText
            )}

        </div>


        <div class="options">

    `;


    options.forEach(
        (option, index) => {

            let className =
                "option";

            if (
                selectedAnswers[current] ===
                index
            ) {

                className +=
                    " selected";

            }

            if (
                checked[current]
            ) {

                const correctAnswer =
                    normalizeAnswer(
                        q.answer
                    );

                if (
                    index ===
                    correctAnswer
                ) {

                    className +=
                        " correct";

                }

                else if (
                    selectedAnswers[current] ===
                    index
                ) {

                    className +=
                        " wrong";

                }

            }

            html += `

                <button
                    type="button"
                    class="${className}"
                    onclick="
                        selectOption(${index})
                    "
                    ${
                        checked[current]
                            ? "disabled"
                            : ""
                    }
                >

                    <b>
                        ${String.fromCharCode(
                            65 + index
                        )}.
                    </b>

                    <span>
                        ${quizEscape(
                            option
                        )}
                    </span>

                </button>

            `;

        }
    );


    html += `

        </div>

    `;


    document.getElementById(
        "question"
    ).innerHTML =
        html;


    const feedback =
        document.getElementById(
            "feedback"
        );

    const explanation =
        document.getElementById(
            "explanation"
        );


    feedback.innerHTML = "";

    explanation.innerHTML = "";

    explanation.classList.add(
        "hidden"
    );


    /* =====================================
       SHOW RESULT AFTER CHECK
    ===================================== */

    if (
        checked[current]
    ) {

        const correctAnswer =
            normalizeAnswer(
                q.answer
            );

        const isCorrect =
            selectedAnswers[current] ===
            correctAnswer;

        if (isCorrect) {

            feedback.innerHTML =
                "✅ Correct Answer";

        }

        else {

            feedback.innerHTML =
                `❌ Wrong Answer — Correct: ${
                    correctAnswer >= 0
                        ? String.fromCharCode(
                            65 + correctAnswer
                        )
                        : "N/A"
                }`;

        }


        explanation.innerHTML = `

            <b>
                Explanation
            </b>

            <br><br>

            ${quizEscape(
                q.explanation ||
                "इस प्रश्न की explanation उपलब्ध नहीं है।"
            )}

        `;

        explanation.classList.remove(
            "hidden"
        );
    }


    const checkButton =
        document.getElementById(
            "checkBtn"
        );


    if (checkButton) {

        checkButton.disabled =
            checked[current];

    }


    const submitButton =
        document.getElementById(
            "submitBtn"
        );

    if (submitButton) {

        submitButton.disabled =
            false;

    }


    document.getElementById(
        "prevBtn"
    ).disabled =
        current === 0;

    document.getElementById(
        "nextBtn"
    ).disabled =
        current ===
        quizQuestions.length - 1;

    renderPalette();
}


/* =========================================
   SELECT OPTION
========================================= */

function selectOption(index) {

    if (
        checked[current]
    ) {

        return;

    }

    selectedAnswers[current] =
        index;

    renderQuizQuestion();
}


/* =========================================
   CHECK ANSWER
========================================= */

function checkAnswer() {

    if (
        selectedAnswers[current] ===
        null
    ) {

        alert(
            "पहले एक option चुनें।"
        );

        return;
    }

    checked[current] =
        true;

    renderQuizQuestion();
}


/* =========================================
   NEXT
========================================= */

function nextQuestion() {

    if (
        current <
        quizQuestions.length - 1
    ) {

        current++;

        renderQuizQuestion();

        window.scrollTo(
            0,
            0
        );
    }
}


/* =========================================
   PREVIOUS
========================================= */

function prevQuestion() {

    if (
        current > 0
    ) {

        current--;

        renderQuizQuestion();

        window.scrollTo(
            0,
            0
        );
    }
}


/* =========================================
   QUESTION PALETTE
========================================= */

function renderPalette() {

    const palette =
        document.getElementById(
            "palette"
        );

    if (!palette) {
        return;
    }

    let html = "";

    quizQuestions.forEach(
        (q, index) => {

            let className =
                "pal";

            /*
               ATTEMPTED QUESTION
               = GREEN

               Current question agar already attempted
               hai to GREEN hi rahega.

               Current + unanswered
               = BLUE.
            */

            if (
                selectedAnswers[index] !== null
            ) {

                className +=
                    " answered";

            }

            else if (
                index === current
            ) {

                className +=
                    " current";

            }


            html += `

                <button
                    type="button"
                    class="${className}"
                    onclick="
                        goToQuestion(${index})
                    "
                >
                    ${index + 1}
                </button>

            `;

        }
    );

    palette.innerHTML =
        html;
}


/* =========================================
   GO TO QUESTION
========================================= */

function goToQuestion(index) {

    if (
        index < 0 ||
        index >= quizQuestions.length
    ) {

        return;

    }

    current =
        index;

    renderQuizQuestion();

    window.scrollTo(
        0,
        0
    );
}


/* =========================================
   BACK FROM QUIZ TO SECTIONS
========================================= */

function backFromQuiz() {

    const quizScreen =
        document.getElementById(
            "quizScreen"
        );

    const quizHome =
        document.getElementById(
            "quizHome"
        );

    const quizSetup =
        document.getElementById(
            "quizSetup"
        );

    const quizResult =
        document.getElementById(
            "quizResult"
        );


    if (quizScreen) {
        quizScreen.classList.add("hidden");
    }

    if (quizSetup) {
        quizSetup.classList.add("hidden");
    }

    if (quizResult) {
        quizResult.classList.add("hidden");
    }

    if (quizHome) {
        quizHome.classList.remove("hidden");
    }


    selectedSection = null;
    quizQuestions = [];
    current = 0;
    selectedAnswers = [];
    checked = [];
    reviewMode = false;


    window.scrollTo(
        0,
        0
    );
}


/* =========================================
   SUBMIT QUIZ
========================================= */

function submitQuiz() {

    if (!quizQuestions.length) {
        return;
    }

    let score = 0;

    quizQuestions.forEach(
        (q, index) => {

            const correct =
                normalizeAnswer(
                    q.answer
                );

            if (
                selectedAnswers[index] ===
                correct
            ) {

                score++;

            }

        }
    );

    const total =
        quizQuestions.length;

    const percentage =
        total
            ? Math.round(
                (score / total) * 100
            )
            : 0;

    const attempted =
        selectedAnswers.filter(
            answer =>
                answer !== null
        ).length;

    const quizScreen =
        document.getElementById(
            "quizScreen"
        );

    const quizResult =
        document.getElementById(
            "quizResult"
        );

    if (quizScreen) {
        quizScreen.classList.add("hidden");
    }

    if (quizResult) {
        quizResult.classList.remove("hidden");
    }

    document.getElementById(
        "resultText"
    ).innerHTML = `

        <div>

            Score:

            <strong>
                ${score} / ${total}
            </strong>

        </div>


        <div>

            Percentage:

            <strong>
                ${percentage}%
            </strong>

        </div>


        <div>

            Attempted:

            <strong>
                ${attempted}
            </strong>

        </div>

    `;

    window.scrollTo(
        0,
        0
    );
}


/* =========================================
   REVIEW ANSWERS
========================================= */

function reviewAnswers() {

    reviewMode = true;

    document.getElementById(
        "quizResult"
    ).classList.add("hidden");

    document.getElementById(
        "quizScreen"
    ).classList.remove("hidden");

    current = 0;

    checked =
        new Array(
            quizQuestions.length
        ).fill(true);

    renderQuizQuestion();

    window.scrollTo(
        0,
        0
    );
}
/* =========================================
   RESTART
   SAME QUIZ PAGE
========================================= */

function restartQuiz() {

    const confirmed =
        window.confirm(
            "क्या आप Quiz Restart करना चाहते हैं?"
        );

    if (!confirmed) {
        return;
    }

    let restartQuestions = [];

    if (selectedSection) {

        restartQuestions =
            getSectionQuestions(
                selectedSection
            );

    }

    else if (
        Array.isArray(quizQuestions) &&
        quizQuestions.length
    ) {

        restartQuestions =
            quizQuestions.slice();

    }

    if (!restartQuestions.length) {

        alert(
            "Quiz restart नहीं हो सका क्योंकि questions उपलब्ध नहीं हैं।"
        );

        return;
    }

    const countElement =
        document.getElementById(
            "questionCount"
        );

    let count =
        Number(
            countElement?.value
        );

    if (
        !count ||
        count <= 0 ||
        count > restartQuestions.length
    ) {

        count =
            quizQuestions.length &&
            quizQuestions.length <=
                restartQuestions.length
                ? quizQuestions.length
                : restartQuestions.length;

    }

    quizQuestions =
        restartQuestions.slice(
            0,
            count
        );

    current = 0;

    selectedAnswers =
        new Array(
            quizQuestions.length
        ).fill(null);

    checked =
        new Array(
            quizQuestions.length
        ).fill(false);

    reviewMode = false;


    const quizResult =
        document.getElementById(
            "quizResult"
        );

    if (quizResult) {

        quizResult.classList.add(
            "hidden"
        );

    }


    const quizSetup =
        document.getElementById(
            "quizSetup"
        );

    if (quizSetup) {

        quizSetup.classList.add(
            "hidden"
        );

    }


    const quizHome =
        document.getElementById(
            "quizHome"
        );

    if (quizHome) {

        quizHome.classList.add(
            "hidden"
        );

    }


    const quizScreen =
        document.getElementById(
            "quizScreen"
        );

    if (quizScreen) {

        quizScreen.classList.remove(
            "hidden"
        );

    }


    renderQuizQuestion();

    window.scrollTo(
        0,
        0
    );
}

window.restartQuiz = restartQuiz;

/* =========================================
   KEYBOARD SHORTCUTS
   N = Next
   P = Previous
========================================= */

document.addEventListener(
    "keydown",
    function(event) {

        const tag =
            document.activeElement?.tagName;

        if (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT"
        ) {

            return;

        }


        const screen =
            document.getElementById(
                "quizScreen"
            );


        if (
            !screen ||
            screen.classList.contains(
                "hidden"
            )
        ) {

            return;

        }


        if (
            event.key.toLowerCase() ===
            "n"
        ) {

            nextQuestion();

        }


        if (
            event.key.toLowerCase() ===
            "p"
        ) {

            prevQuestion();

        }

    }
);