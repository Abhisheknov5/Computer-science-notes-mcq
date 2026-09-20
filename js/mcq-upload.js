/* =========================================
   MCQ HTML UPLOAD SYSTEM
   CLASS 6 PHYSICS
========================================= */

const MCQ_UPLOAD_CHAPTERS = [
    {
        number: 7,
        title: "गति एवं दूरियों का मापन"
    },
    {
        number: 8,
        title: "प्रकाश–छायाएँ एवं परावर्तन"
    },
    {
        number: 9,
        title: "विद्युत तथा परिपथ"
    },
    {
        number: 10,
        title: "चुंबकों द्वारा मनोरंजन"
    }
];


function addMCQUploadBox() {

    const hash = window.location.hash || "";

    /*
        Upload box सिर्फ
        Class 6 → Physics page पर दिखेगा
    */
    if (hash !== "#subject/6/physics") {
        return;
    }


    /*
        Duplicate upload box बनने से रोकना
    */
    if (document.getElementById("mcqUploadBox")) {
        return;
    }


    const loading = document.getElementById("chapterLoading");

    if (!loading) {
        return;
    }


    /* =========================================
       UPLOAD BOX
    ========================================== */

    const box = document.createElement("div");

    box.id = "mcqUploadBox";

    box.className = "card";

    box.style.marginBottom = "18px";


    box.innerHTML = `

        <h2>
            📤 Upload MCQ HTML
        </h2>


        <p>
            Chapter की original HTML MCQ file upload करें।
        </p>


        <div
            style="
                display:flex;
                gap:12px;
                flex-wrap:wrap;
                align-items:center;
                margin-top:14px;
            "
        >


            <!-- CHAPTER SELECT -->

            <select
                id="mcqUploadChapter"
                class="btn"
                style="padding:10px 14px;"
            >

                <option value="">
                    Select Chapter
                </option>


                ${MCQ_UPLOAD_CHAPTERS
                    .map(
                        chapter => `
                            <option value="${chapter.number}">
                                Chapter ${chapter.number} — ${chapter.title}
                            </option>
                        `
                    )
                    .join("")
                }

            </select>


            <!-- FILE INPUT -->

            <input
                type="file"
                id="mcqUploadFile"
                accept=".html,.htm,text/html"
                style="display:none;"
            >


            <!-- CHOOSE FILE -->

            <button
                type="button"
                class="btn btn-blue"
                id="mcqChooseFileBtn"
            >
                📁 Choose HTML File
            </button>


            <!-- UPLOAD -->

            <button
                type="button"
                class="btn btn-green"
                id="mcqUploadBtn"
                disabled
            >
                ⬆️ Upload
            </button>

        </div>


        <!-- SELECTED FILE -->

        <p
            id="mcqUploadFileName"
            style="margin-top:12px;"
        >
            कोई HTML file select नहीं की गई।
        </p>


        <!-- STATUS -->

        <p
            id="mcqUploadStatus"
            style="
                margin-top:8px;
                font-weight:600;
            "
        ></p>

    `;


    /*
        Loading ke upar upload box
    */
    loading.parentNode.insertBefore(
        box,
        loading
    );


    /* =========================================
       ELEMENTS
    ========================================== */

    const chapterSelect =
        document.getElementById(
            "mcqUploadChapter"
        );


    const fileInput =
        document.getElementById(
            "mcqUploadFile"
        );


    const chooseButton =
        document.getElementById(
            "mcqChooseFileBtn"
        );


    const uploadButton =
        document.getElementById(
            "mcqUploadBtn"
        );


    const fileName =
        document.getElementById(
            "mcqUploadFileName"
        );


    const status =
        document.getElementById(
            "mcqUploadStatus"
        );


    /* =========================================
       CHOOSE FILE
    ========================================== */

    chooseButton.onclick = () => {

        fileInput.click();

    };


    /* =========================================
       FILE SELECTED
    ========================================== */

    fileInput.onchange = () => {

        const file =
            fileInput.files?.[0];


        if (!file) {

            fileName.textContent =
                "कोई HTML file select नहीं की गई।";

            uploadButton.disabled = true;

            return;
        }


        fileName.textContent =
            `Selected: ${file.name}`;


        /*
            Filename se chapter automatically
            detect karega.

            Example:

            chapter-07.html
            chapter-08.html
            chapter-09.html
            chapter-10.html
        */

        const match =
            file.name.match(
                /chapter[-_ ]?0*(7|8|9|10)(?:\D|$)/i
            );


        if (
            match &&
            !chapterSelect.value
        ) {

            chapterSelect.value =
                match[1];

        }


        uploadButton.disabled =
            !chapterSelect.value;


        status.textContent = "";

    };


    /* =========================================
       CHAPTER CHANGE
    ========================================== */

    chapterSelect.onchange = () => {

        uploadButton.disabled =
            !chapterSelect.value ||
            !fileInput.files?.[0];

    };


    /* =========================================
       UPLOAD
    ========================================== */

    uploadButton.onclick = async () => {

        const file =
            fileInput.files?.[0];


        const chapterNumber =
            Number(
                chapterSelect.value
            );


        /* -------------------------------------
           FILE CHECK
        -------------------------------------- */

        if (!file) {

            status.textContent =
                "पहले HTML file select करें।";

            return;
        }


        /* -------------------------------------
           CHAPTER CHECK
        -------------------------------------- */

        if (!chapterNumber) {

            status.textContent =
                "पहले Chapter select करें।";

            return;
        }


        /* -------------------------------------
           HTML CHECK
        -------------------------------------- */

        if (!/\.html?$/i.test(file.name)) {

            status.textContent =
                "सिर्फ HTML file upload करें।";

            return;
        }


        /* -------------------------------------
           BUTTON DISABLE
        -------------------------------------- */

        uploadButton.disabled = true;

        chooseButton.disabled = true;

        chapterSelect.disabled = true;


        status.textContent =
            "Uploading... Please wait.";


        try {

            /* =================================
               READ HTML FILE
            ================================= */

            const html =
                await file.text();


            if (!html.trim()) {

                throw new Error(
                    "HTML file empty hai."
                );

            }


            /* =================================
               QUESTIONS ARRAY CHECK
            ================================= */

            if (
                !/const\s+questions\s*=\s*\[/i.test(
                    html
                )
            ) {

                throw new Error(
                    "HTML file mein const questions = [...] nahi mila."
                );

            }


            /* =================================
               SERVER UPLOAD
            ================================= */

            const response =
                await fetch(
                    "/api/upload-mcq-html",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({

                            classNumber: 6,

                            subject: "Physics",

                            chapterNumber:
                                chapterNumber,

                            html: html

                        })

                    }
                );


            const result =
                await response.json();


            /* =================================
               SERVER RESPONSE CHECK
            ================================= */

            if (
                !response.ok ||
                !result.success
            ) {

                throw new Error(
                    result.message ||
                    "Upload failed."
                );

            }


            /* =================================
               SUCCESS
            ================================= */

            status.textContent =
                `✅ Chapter ${chapterNumber} successfully upload ho gaya.`;


            alert(
                `Chapter ${chapterNumber} MCQ HTML successfully upload ho gaya.`
            );


            /*
                Chapter list dobara load hogi.
                Uploaded chapter automatically
                appear karega.
            */

            if (
                typeof router === "function"
            ) {

                router();

            } else {

                window.location.reload();

            }


        } catch (error) {

            console.error(
                "MCQ HTML Upload Error:",
                error
            );


            status.textContent =
                `❌ ${error.message}`;


            /*
                Error hone par buttons
                dobara enable
            */

            uploadButton.disabled = false;

            chooseButton.disabled = false;

            chapterSelect.disabled = false;

        }

    };

}


/* =========================================
   PAGE LOAD
========================================= */

window.addEventListener(
    "DOMContentLoaded",
    () => {

        setTimeout(
            addMCQUploadBox,
            100
        );

    }
);


/* =========================================
   HASH CHANGE
========================================= */

window.addEventListener(
    "hashchange",
    () => {

        setTimeout(
            addMCQUploadBox,
            100
        );

    }
);