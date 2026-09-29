const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const CS_CHAPTERS_FILE = path.join(DATA_DIR, "cs-chapters.json");
const FIREBASE_SECRET_PATH = "/etc/secrets/firebase-service-account.json";
const FIREBASE_LOCAL_PATH =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(ROOT_DIR, "firebase-service-account.json");

let db = null;
let firebaseEnabled = false;

function initializeFirebase() {
    const credentialPath = fs.existsSync(FIREBASE_SECRET_PATH)
        ? FIREBASE_SECRET_PATH
        : (fs.existsSync(FIREBASE_LOCAL_PATH)
            ? FIREBASE_LOCAL_PATH
            : null);

    if (!credentialPath) {
        console.log("Firebase: credentials not found. Local JSON storage will be used.");
        return;
    }

    try {
        const serviceAccount = JSON.parse(
            fs.readFileSync(credentialPath, "utf8")
        );

        if (!serviceAccount.project_id) {
            throw new Error("Firebase service-account JSON is missing project_id.");
        }

        if (!serviceAccount.private_key) {
            throw new Error("Firebase service-account JSON is missing private_key.");
        }

        initializeApp({
            credential: cert(serviceAccount)
        });

        db = getFirestore();

        // HTML MCQ files are stored directly in Firestore.
        // This avoids requiring a Firebase Storage bucket.
        firebaseEnabled = true;

        console.log(
            `Firebase Firestore: connected (${serviceAccount.project_id})`
        );
    } catch (error) {
        console.error(
            "Firebase initialization failed:",
            error.message
        );
    }
}

initializeFirebase();

function firestoreQuizId(classNumber, subject, chapterNumber) {
    const info = validateMCQLocation(
        classNumber,
        subject,
        chapterNumber
    );

    return `class${info.classNumber}_${info.subject}_${info.chapterNumber}`;
}

function firestoreQuizRef(classNumber, subject, chapterNumber) {
    if (!firebaseEnabled || !db) {
        return null;
    }

    return db
        .collection("mcqQuizzes")
        .doc(
            firestoreQuizId(
                classNumber,
                subject,
                chapterNumber
            )
        );
}

function firestoreHTMLRef(id) {
    if (!firebaseEnabled || !db) return null;
    return db.collection("mcqHtml").doc(String(id));
}

async function saveHTMLToFirebase(info, item, html) {
    if (!firebaseEnabled || !db) return false;

    const htmlSize = Buffer.byteLength(
        String(html),
        "utf8"
    );

    // Firestore documents have a 1 MiB limit. Keep a safety margin.
    if (htmlSize > 900000) {
        throw new Error(
            "HTML MCQ file 900 KB se bada hai. Current Firebase setup mein HTML ko Firestore document ke andar store karne ke liye file chhoti honi chahiye."
        );
    }

    const ref = firestoreHTMLRef(item.id);

    await ref.set({
        ...item,
        classNumber: Number(info.classNumber),
        subject: String(info.subject).toLowerCase(),
        chapterNumber: Number(info.chapterNumber),
        html: String(html),
        htmlSize,
        storageType: "firestore",
        updatedAt: new Date().toISOString()
    });

    return true;
}

async function getHTMLFromFirebase(id) {
    const ref = firestoreHTMLRef(id);
    if (!ref) return null;

    const snapshot = await ref.get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();

    if (typeof data.html === "string") {
        return data;
    }

    // Backward compatibility for any old document that may still contain
    // a Storage path. Current uploads no longer depend on Storage.
    return data;
}

async function listHTMLFromFirestore(classNumber, subject, chapterNumber) {
    if (!firebaseEnabled || !db) return [];

    const snapshot = await db
        .collection("mcqHtml")
        .where("classNumber", "==", Number(classNumber))
        .where("subject", "==", String(subject).toLowerCase())
        .where("chapterNumber", "==", Number(chapterNumber))
        .get();

    return snapshot.docs.map(doc => {
        const data = doc.data();

        return {
            id: doc.id,
            fileName: data.fileName,
            originalName: data.originalName,
            name: data.name,
            questionCount: data.questionCount,
            subtopicId: data.subtopicId || null,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            url: `/api/mcq-html/file/${encodeURIComponent(doc.id)}`,
            source: "firebase-firestore"
        };
    });
}

async function renameHTMLInFirebase(info, id, newFileName, newName) {
    const ref = firestoreHTMLRef(id);
    if (!ref) return false;

    const snapshot = await ref.get();
    if (!snapshot.exists) return false;

    await ref.set({
        fileName: newFileName,
        name: newName,
        updatedAt: new Date().toISOString()
    }, { merge: true });

    return true;
}

async function deleteHTMLFromFirebase(id) {
    const ref = firestoreHTMLRef(id);
    if (!ref) return false;

    const snapshot = await ref.get();
    if (!snapshot.exists) return false;

    await ref.delete();
    return true;
}

async function saveQuizToFirestore(
    classNumber,
    subject,
    chapterNumber,
    data
) {
    const ref = firestoreQuizRef(
        classNumber,
        subject,
        chapterNumber
    );

    if (!ref) {
        return false;
    }

    const serializedSize = Buffer.byteLength(
        JSON.stringify(data),
        "utf8"
    );

    if (serializedSize > 900000) {
        throw new Error(
            "MCQ data Firestore document limit ke bahut close hai. Is quiz ko chhote parts mein store karna hoga."
        );
    }

    await ref.set({
        ...data,
        classNumber: Number(classNumber),
        subject: String(subject).toLowerCase(),
        chapterNumber: Number(chapterNumber),
        updatedAt: new Date().toISOString()
    });

    return true;
}


app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ======================================================
   OWNER / ADMIN
====================================================== */

const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "admin123";
const OWNER_COOKIE = "ncert_owner";
const SESSION_TIME = 8 * 60 * 60 * 1000;

const sessions = new Map();

function parseCookies(req) {
    const cookies = {};
    const header = req.headers.cookie || "";

    header.split(";").forEach(part => {
        const index = part.indexOf("=");

        if (index === -1) return;

        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();

        try {
            cookies[key] = decodeURIComponent(value);
        } catch {
            cookies[key] = value;
        }
    });

    return cookies;
}

function isOwner(req) {
    const token = parseCookies(req)[OWNER_COOKIE];

    if (!token) return false;

    const expires = sessions.get(token);

    if (!expires) return false;

    if (expires <= Date.now()) {
        sessions.delete(token);
        return false;
    }

    return true;
}

function requireOwner(req, res, next) {
    if (!isOwner(req)) {
        return res.status(401).json({
            success: false,
            message: "Admin login required."
        });
    }

    next();
}

/* ======================================================
   COMPUTER SCIENCE SITE ACCESS
   Whole website + API protection
   Separate from existing Admin/Owner login
====================================================== */

const CS_SITE_USERNAME =
    process.env.CS_SITE_USERNAME || "abhi";

const CS_SITE_PASSWORD =
    process.env.CS_SITE_PASSWORD || "admin123";

const CS_SITE_SESSION_SECRET =
    process.env.CS_SITE_SESSION_SECRET || "cs-private-session-2026-abhi";

const CS_SITE_COOKIE = "cs_site_auth";
const CS_SITE_SESSION_TIME = 30 * 24 * 60 * 60 * 1000;

function createCSSiteToken() {
    return crypto
        .createHmac("sha256", CS_SITE_SESSION_SECRET)
        .update(`${CS_SITE_USERNAME}:${CS_SITE_PASSWORD}`)
        .digest("hex");
}

function isCSSiteLoggedIn(req) {
    const token = parseCookies(req)[CS_SITE_COOKIE];

    if (!token) return false;

    const expected = createCSSiteToken();

    if (token.length !== expected.length) return false;

    return crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(expected)
    );
}

function setCSSiteCookie(res, token, maxAge) {
    res.setHeader(
        "Set-Cookie",
        `${CS_SITE_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Path=/`
    );
}

function csSiteLoginPage(res) {
    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Computer Science Notes + MCQ - Login</title>
<style>
*{box-sizing:border-box}
body{
    margin:0;
    min-height:100vh;
    display:flex;
    align-items:center;
    justify-content:center;
    font-family:Arial,sans-serif;
    background:#f4f7fb;
}
.login-box{
    width:520px;
    max-width:94%;
    background:#fff;
    padding:44px;
    border-radius:16px;
    box-shadow:0 10px 35px rgba(0,0,0,.12);
}
.logo{
    text-align:center;
    font-size:34px;
    margin-bottom:12px;
}
h2{
    margin:0 0 12px;
    text-align:center;
    font-size:28px;
}
.subtitle{
    margin:0 0 26px;
    text-align:center;
    font-size:17px;
    color:#666;
}
input{
    width:100%;
    padding:16px;
    margin:9px 0;
    border:1px solid #d7dce5;
    border-radius:10px;
    font-size:17px;
    outline:none;
}
input:focus{
    border-color:#2563eb;
}
button{
    width:100%;
    padding:16px;
    margin-top:16px;
    border:0;
    border-radius:10px;
    background:#2563eb;
    color:#fff;
    font-size:18px;
    cursor:pointer;
}
button:disabled{
    opacity:.65;
    cursor:not-allowed;
}
#error{
    display:none;
    color:#dc2626;
    text-align:center;
    margin-top:12px;
    font-size:14px;
}
</style>
</head>
<body>
<div class="login-box">
    <div class="logo">📚</div>
    <h2>Computer Science Notes + MCQ</h2>
    <p class="subtitle">Login required to access this website</p>

    <form id="loginForm">
        <input
            type="text"
            id="username"
            placeholder="Username"
            autocomplete="username"
            required
        >

        <input
            type="password"
            id="password"
            placeholder="Password"
            autocomplete="current-password"
            required
        >

        <button id="loginButton" type="submit">Login</button>

        <div id="error">
            Invalid username or password.
        </div>
    </form>
</div>

<script>
document.getElementById("loginForm").addEventListener("submit", async function(event){
    event.preventDefault();

    const button = document.getElementById("loginButton");
    const error = document.getElementById("error");

    error.style.display = "none";
    button.disabled = true;
    button.textContent = "Logging in...";

    try {
        const response = await fetch("/api/cs-site-login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: document.getElementById("username").value,
                password: document.getElementById("password").value
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            window.location.href = "/";
            return;
        }

        error.textContent = data.message || "Invalid username or password.";
        error.style.display = "block";
    } catch (error) {
        error.textContent = "Login failed. Please try again.";
        error.style.display = "block";
    }

    button.disabled = false;
    button.textContent = "Login";
});
</script>
</body>
</html>`);
}

/*
 * Site login endpoint must be registered before the site-protection
 * middleware so an unauthenticated visitor can authenticate.
 */
app.post("/api/cs-site-login", (req, res) => {
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");

    if (
        username !== CS_SITE_USERNAME ||
        password !== CS_SITE_PASSWORD
    ) {
        return res.status(401).json({
            success: false,
            message: "Invalid username or password."
        });
    }

    const token = createCSSiteToken();

    setCSSiteCookie(
        res,
        token,
        Math.floor(CS_SITE_SESSION_TIME / 1000)
    );

    return res.json({
        success: true,
        authenticated: true
    });
});

app.post("/api/cs-site-logout", (req, res) => {
    setCSSiteCookie(res, "", 0);

    return res.json({
        success: true,
        authenticated: false
    });
});

/*
 * Everything after this middleware requires the site login.
 * Existing Admin/Owner authentication remains separate and unchanged.
 */
app.use((req, res, next) => {
    if (
        req.path === "/api/cs-site-login" ||
        req.path === "/api/cs-site-logout"
    ) {
        return next();
    }

    if (isCSSiteLoggedIn(req)) {
        return next();
    }

    if (req.path.startsWith("/api/")) {
        return res.status(401).json({
            success: false,
            message: "Website login required."
        });
    }

    return csSiteLoginPage(res);
});

/* ======================================================
   SUBJECT FOLDER
====================================================== */

function subjectFolder(subject) {
    const map = {
        physics: "Physics",
        Physics: "Physics",

        chemistry: "Chemistry",
        Chemistry: "Chemistry",

        biology: "Biology",
        Biology: "Biology",

        "environmental-science": "Environmental-Science",
        "Environmental Science": "Environmental-Science",
        "Environmental-Science": "Environmental-Science"
    };

    const value = String(subject || "").trim();

    return map[value] || value;
}

/* ======================================================
   CHAPTER VALIDATION
====================================================== */

function safeChapter(value) {
    const chapter = Number(value);

    if (
        !Number.isInteger(chapter) ||
        chapter < 1 ||
        chapter > 100
    ) {
        throw new Error("Invalid chapter number.");
    }

    return chapter;
}

function validateMCQLocation(
    classNumber,
    subject,
    chapterNumber
) {
    const cls = Number(classNumber);
    const sub = String(subject || "")
        .trim()
        .toLowerCase();

    const chapter = safeChapter(chapterNumber);

    if (!Number.isInteger(cls) || cls < 6 || cls > 12) {
        throw new Error(
            "Class 6 se 12 ke beech honi chahiye."
        );
    }

    const allowedSubjects = [
        "physics",
        "chemistry",
        "biology",
        "environmental-science"
    ];

    if (!allowedSubjects.includes(sub)) {
        throw new Error(
            "General Science subject valid nahi hai."
        );
    }

    return {
        classNumber: cls,
        subject: sub,
        chapterNumber: chapter
    };
}

/* ======================================================
   SUBJECT NOTES LINK MAPPING
   One Google Drive / Google Docs folder link per Class + Subject.
====================================================== */

const SUBJECT_NOTES_FILE = path.join(DATA_DIR, "subject-notes.json");

function normalizeSubject(subject) {
    const sub = String(subject || "").trim().toLowerCase();
    const allowedSubjects = [
        "physics",
        "chemistry",
        "biology",
        "environmental-science"
    ];
    if (!allowedSubjects.includes(sub)) {
        throw new Error("General Science subject valid nahi hai.");
    }
    return sub;
}

function subjectNotesDocId(classNumber, subject) {
    const cls = Number(classNumber);
    const sub = normalizeSubject(subject);
    if (!Number.isInteger(cls) || cls < 6 || cls > 12 || !sub) {
        throw new Error("Invalid Class / Subject.");
    }
    return `class${cls}_${sub}`;
}

function readLocalSubjectNotes() {
    if (!fs.existsSync(SUBJECT_NOTES_FILE)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(SUBJECT_NOTES_FILE, "utf8"));
        return Array.isArray(data.items) ? data.items : [];
    } catch {
        return [];
    }
}

function writeLocalSubjectNotes(items) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${SUBJECT_NOTES_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ items }, null, 2), "utf8");
    fs.renameSync(temp, SUBJECT_NOTES_FILE);
}

async function getFirebaseSubjectNotes(classNumber, subject) {
    if (!firebaseEnabled || !db) return null;
    const id = subjectNotesDocId(classNumber, subject);
    const snapshot = await db.collection("subjectNotes").doc(id).get();
    return snapshot.exists ? { ...snapshot.data(), id } : null;
}

async function saveSubjectNotes(classNumber, subject, notesUrl) {
    const cls = Number(classNumber);
    const sub = normalizeSubject(subject);
    const id = subjectNotesDocId(cls, sub);
    const now = new Date().toISOString();

    const item = {
        id,
        classNumber: cls,
        subject: sub,
        notesUrl,
        updatedAt: now,
        source: "admin"
    };

    const local = readLocalSubjectNotes();
    const index = local.findIndex(x => x.id === id);
    if (index >= 0) local[index] = { ...local[index], ...item };
    else local.push({ ...item, createdAt: now });
    writeLocalSubjectNotes(local);

    let firebaseSaved = false;
    if (firebaseEnabled && db) {
        await db.collection("subjectNotes").doc(id).set(
            { ...item, createdAt: local.find(x => x.id === id)?.createdAt || now },
            { merge: true }
        );
        firebaseSaved = true;
    }

    return { item, firebaseSaved };
}

async function deleteSubjectNotes(classNumber, subject) {
    const id = subjectNotesDocId(classNumber, subject);
    const local = readLocalSubjectNotes();
    writeLocalSubjectNotes(local.filter(item => item.id !== id));

    let firebaseDeleted = false;
    if (firebaseEnabled && db) {
        const ref = db.collection("subjectNotes").doc(id);
        const snapshot = await ref.get();
        if (snapshot.exists) {
            await ref.delete();
            firebaseDeleted = true;
        }
    }

    return { id, firebaseDeleted };
}

/* ======================================================
   CHAPTER REGISTRY
   IMPORTANT:
   Public chapter list mein sirf wahi chapters aayenge
   jo Admin se Save Chapter kiye gaye hain.

   Existing MCQ/Notes folders ko automatically discover
   karke public list mein add nahi kiya jayega.
====================================================== */

const CHAPTERS_FILE = path.join(
    DATA_DIR,
    "chapters.json"
);

function chapterDocId(classNumber, subject, chapterNumber) {
    const info = validateMCQLocation(
        classNumber,
        subject,
        chapterNumber
    );

    return `class${info.classNumber}_${info.subject}_${info.chapterNumber}`;
}

function readLocalChapters() {
    if (!fs.existsSync(CHAPTERS_FILE)) return [];

    try {
        const data = JSON.parse(
            fs.readFileSync(CHAPTERS_FILE, "utf8")
        );

        return Array.isArray(data.items)
            ? data.items
            : [];
    } catch {
        return [];
    }
}

function writeLocalChapters(items) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });

    const temp =
        `${CHAPTERS_FILE}.tmp`;

    fs.writeFileSync(
        temp,
        JSON.stringify(
            { items },
            null,
            2
        ),
        "utf8"
    );

    fs.renameSync(
        temp,
        CHAPTERS_FILE
    );
}

async function getFirebaseChapters() {
    if (!firebaseEnabled || !db) {
        return [];
    }

    const snapshot =
        await db
            .collection("chapters")
            .get();

    return snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
    }));
}

async function listChapters(
    classNumber,
    subject
) {
    const info =
        validateMCQLocation(
            classNumber,
            subject,
            1
        );

    const merged =
        new Map();

    // ONLY Admin-created local chapters.
    readLocalChapters()
        .filter(item =>
            Number(item.classNumber) ===
                info.classNumber &&
            String(item.subject).toLowerCase() ===
                info.subject
        )
        .forEach(item => {
            merged.set(
                `${info.classNumber}_${info.subject}_${item.number}`,
                item
            );
        });

    // ONLY Admin-created Firebase chapters.
    const firebaseItems =
        await getFirebaseChapters();

    firebaseItems
        .filter(item =>
            Number(item.classNumber) ===
                info.classNumber &&
            String(item.subject).toLowerCase() ===
                info.subject
        )
        .forEach(item => {
            merged.set(
                `${info.classNumber}_${info.subject}_${item.number}`,
                item
            );
        });

    return Array.from(
        merged.values()
    ).sort(
        (a, b) =>
            Number(a.number) -
            Number(b.number)
    );
}


/* ======================================================
   DIRECTORY
====================================================== */

function chapterDir(
    classNumber,
    subject,
    chapterNumber
) {
    const info = validateMCQLocation(
        classNumber,
        subject,
        chapterNumber
    );

    return path.join(
        DATA_DIR,
        `class${info.classNumber}`,
        "MCQ",
        subjectFolder(info.subject),
        `chapter-${String(info.chapterNumber).padStart(2, "0")}`
    );
}

function metadataPath(dir) {
    return path.join(dir, "index.json");
}

/* ======================================================
   METADATA
====================================================== */

function readMetadata(dir) {
    const file = metadataPath(dir);

    if (!fs.existsSync(file)) {
        return [];
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(file, "utf8")
        );

        return Array.isArray(data.items)
            ? data.items
            : [];
    } catch {
        return [];
    }
}

function writeMetadata(dir, items) {
    fs.mkdirSync(dir, {
        recursive: true
    });

    const tempFile =
        `${metadataPath(dir)}.tmp`;

    fs.writeFileSync(
        tempFile,
        JSON.stringify(
            { items },
            null,
            2
        ),
        "utf8"
    );

    fs.renameSync(
        tempFile,
        metadataPath(dir)
    );
}

/* ======================================================
   HTML TITLE
====================================================== */

function htmlTitle(html) {
    const match = String(html || "").match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
    );

    if (!match) return "";

    return match[1]
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/* ======================================================
   QUESTION COUNT
====================================================== */

function questionCountFromHTML(html) {
    const text = String(html || "");

    const match =
        /const\s+questions\s*=\s*\[/i.exec(text);

    if (!match) {
        throw new Error(
            "HTML file me const questions = [...] nahi mila."
        );
    }

    const first =
        text.indexOf("[", match.index);

    let square = 0;
    let curly = 0;
    let quote = null;
    let escaped = false;

    let count = 0;
    let objectStarted = false;

    for (
        let i = first;
        i < text.length;
        i++
    ) {
        const ch = text[i];

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (ch === "\\") {
                escaped = true;
                continue;
            }

            if (ch === quote) {
                quote = null;
            }

            continue;
        }

        if (
            ch === '"' ||
            ch === "'" ||
            ch === "`"
        ) {
            quote = ch;
            continue;
        }

        if (ch === "[") {
            square++;
        }

        if (ch === "]") {
            square--;

            if (square === 0) {
                break;
            }
        }

        if (ch === "{") {
            curly++;

            if (
                square === 1 &&
                curly === 1
            ) {
                objectStarted = true;
            }
        }

        if (ch === "}") {
            if (
                square === 1 &&
                curly === 1 &&
                objectStarted
            ) {
                count++;
                objectStarted = false;
            }

            curly--;
        }
    }

    if (count <= 0) {
        throw new Error(
            "HTML me questions array mila, lekin questions detect nahi hue."
        );
    }

    return count;
}

/* ======================================================
   SAFE FILE NAME
====================================================== */

function sanitizeFileBaseName(value) {
    let name = String(value || "")
        .trim();

    name = name.replace(
        /\.(html?|HTML?)$/i,
        ""
    );

    name = name.replace(
        /[<>:"/\\|?*\x00-\x1F]/g,
        "_"
    );

    name = name
        .replace(/\s+/g, " ")
        .trim();

    name = name.replace(
        /^\.+|\.+$/g,
        ""
    );

    if (!name) {
        throw new Error(
            "MCQ file name empty nahi ho sakta."
        );
    }

    if (name.length > 120) {
        name = name
            .slice(0, 120)
            .trim();
    }

    return name;
}

/* ======================================================
   PUBLIC MCQ LIST
====================================================== */

function publicItems(
    classNumber,
    subject,
    chapterNumber
) {
    const dir = chapterDir(
        classNumber,
        subject,
        chapterNumber
    );

    const items = readMetadata(dir);

    return items
        .filter(
            item =>
                item &&
                item.fileName
        )
        .filter(
            item =>
                fs.existsSync(
                    path.join(
                        dir,
                        item.fileName
                    )
                )
        )
        .map(item => ({
            ...item,

            url:
                `/api/mcq-html/file/${encodeURIComponent(item.id)}`
        }));
}

/* ======================================================
   LEGACY MIGRATION
====================================================== */

function migrateLegacyHTMLFiles() {
    const base = path.join(
        DATA_DIR,
        "class6",
        "MCQ",
        "Physics"
    );

    if (!fs.existsSync(base)) {
        return;
    }

    for (const chapter of [7, 8, 9, 10]) {
        const oldFile = path.join(
            base,
            `chapter-${String(chapter).padStart(2, "0")}.html`
        );

        if (!fs.existsSync(oldFile)) {
            continue;
        }

        try {
            const dir = chapterDir(
                6,
                "physics",
                chapter
            );

            const items =
                readMetadata(dir);

            if (items.length === 0) {
                const html =
                    fs.readFileSync(
                        oldFile,
                        "utf8"
                    );

                const count =
                    questionCountFromHTML(
                        html
                    );

                const title =
                    htmlTitle(html) ||
                    `Chapter ${chapter} MCQ`;

                const id =
                    `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

                const fileName =
                    "mcq-legacy.html";

                fs.mkdirSync(
                    dir,
                    { recursive: true }
                );

                fs.writeFileSync(
                    path.join(
                        dir,
                        fileName
                    ),
                    html,
                    "utf8"
                );

                const now =
                    new Date().toISOString();

                writeMetadata(
                    dir,
                    [
                        {
                            id,
                            fileName,
                            originalName:
                                path.basename(
                                    oldFile
                                ),
                            name: title,
                            questionCount:
                                count,
                            createdAt: now,
                            updatedAt: now
                        }
                    ]
                );

                console.log(
                    `Migrated legacy MCQ: Chapter ${chapter}`
                );
            }

            fs.renameSync(
                oldFile,
                `${oldFile}.legacy-backup-${Date.now()}`
            );
        } catch (error) {
            console.error(
                `Legacy migration failed for Chapter ${chapter}:`,
                error.message
            );
        }
    }
}

migrateLegacyHTMLFiles();

/* ======================================================
   HEALTH
====================================================== */

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            success: true,
            server: true,
            ai: false,
            message:
                "NCERT MCQ Server running. AI/Ollama disabled."
        });
    }
);

/* ======================================================
   OWNER STATUS
====================================================== */

app.get(
    "/api/owner/status",
    (req, res) => {
        res.json({
            success: true,
            authenticated:
                isOwner(req)
        });
    }
);

/* ======================================================
   OWNER LOGIN
====================================================== */

app.post(
    "/api/owner/login",
    (req, res) => {
        const password =
            String(
                req.body?.password || ""
            );

        if (
            !password ||
            password !== OWNER_PASSWORD
        ) {
            return res
                .status(401)
                .json({
                    success: false,
                    message:
                        "Admin password incorrect hai."
                });
        }

        const token =
            crypto.randomBytes(32)
                .toString("hex");

        sessions.set(
            token,
            Date.now() + SESSION_TIME
        );

        res.setHeader(
            "Set-Cookie",
            `${OWNER_COOKIE}=${encodeURIComponent(token)}; Max-Age=31536000; HttpOnly; SameSite=Lax; Path=/`
        );

        res.json({
            success: true,
            authenticated: true
        });
    }
);

/* ======================================================
   OWNER LOGOUT
====================================================== */

app.post(
    "/api/owner/logout",
    (req, res) => {
        const token =
            parseCookies(req)[
                OWNER_COOKIE
            ];

        if (token) {
            sessions.delete(token);
        }

        res.setHeader(
            "Set-Cookie",
            `${OWNER_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/`
        );

        res.json({
            success: true,
            authenticated: false
        });
    }
);

/* ======================================================
   SUBJECT NOTES API
====================================================== */

app.get(
    "/api/subject-notes/:classNumber/:subject",
    async (req, res) => {
        try {
            const classNumber = Number(req.params.classNumber);
            const subject = normalizeSubject(req.params.subject);
            const id = subjectNotesDocId(classNumber, subject);

            const firebaseItem = await getFirebaseSubjectNotes(classNumber, subject);
            const localItem = readLocalSubjectNotes().find(item => item.id === id) || null;
            const item = firebaseItem || localItem;

            res.json({
                success: true,
                exists: Boolean(item),
                notesUrl: item?.notesUrl || "",
                item
            });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }
);

app.post(
    "/api/subject-notes",
    requireOwner,
    async (req, res) => {
        try {
            const classNumber = Number(req.body.classNumber);
            const subject = normalizeSubject(req.body.subject);
            subjectNotesDocId(classNumber, subject);

            const notesUrl = String(req.body.notesUrl || "").trim();
            if (!notesUrl) {
                return res.status(400).json({
                    success: false,
                    message: "Google Drive folder link required hai."
                });
            }

            if (!/^https:\/\/(drive\.google\.com|docs\.google\.com)\//i.test(notesUrl)) {
                return res.status(400).json({
                    success: false,
                    message: "Valid Google Drive ya Google Docs link dijiye."
                });
            }

            if (notesUrl.length > 2000) {
                return res.status(400).json({
                    success: false,
                    message: "Notes link bahut lamba hai."
                });
            }

            const result = await saveSubjectNotes(classNumber, subject, notesUrl);

            res.json({
                success: true,
                message: result.firebaseSaved
                    ? "Notes folder link Firebase Firestore mein save ho gaya."
                    : "Notes folder link local storage mein save ho gaya.",
                item: result.item,
                firebaseSaved: result.firebaseSaved
            });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }
);

app.delete(
    "/api/subject-notes",
    requireOwner,
    async (req, res) => {
        try {
            const classNumber = Number(req.body.classNumber);
            const subject = normalizeSubject(req.body.subject);
            const id = subjectNotesDocId(classNumber, subject);

            const firebaseItem = await getFirebaseSubjectNotes(classNumber, subject);
            const localItem = readLocalSubjectNotes().find(item => item.id === id);

            if (!firebaseItem && !localItem) {
                return res.status(404).json({
                    success: false,
                    message: "Is Class + Subject ke liye Notes link saved nahi hai."
                });
            }

            const result = await deleteSubjectNotes(classNumber, subject);

            res.json({
                success: true,
                message: result.firebaseDeleted
                    ? "Notes folder link Firestore aur local storage dono se delete ho gaya."
                    : "Notes folder link local storage se delete ho gaya.",
                firebaseDeleted: result.firebaseDeleted
            });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }
);

/* ======================================================
   COMPUTER SCIENCE CHAPTER API
   CS does not use the old Class 6-12 science registry.
====================================================== */

const CS_BUILTIN_SUBJECTS = [
    {id:"ai", name:"Artificial Intelligence (AI)", code:"AI", icon:"🤖", builtIn:true},
    {id:"cn", name:"Computer Networks (CN)", code:"CN", icon:"🌐", builtIn:true},
    {id:"dsa", name:"Data Structures & Algorithms (DSA)", code:"DSA", icon:"🧩", builtIn:true},
    {id:"dbms", name:"Database Management System (DBMS)", code:"DBMS", icon:"🗄️", builtIn:true},
    {id:"de", name:"Digital Electronics (DE)", code:"DE", icon:"🔌", builtIn:true},
    {id:"e-commerce", name:"E-Commerce", code:"E-Commerce", icon:"🛒", builtIn:true},
    {id:"iot", name:"Internet of Things (IoT)", code:"IoT", icon:"📡", builtIn:true},
    {id:"multimedia", name:"Multimedia", code:"Multimedia", icon:"🎞️", builtIn:true},
    {id:"oops", name:"Object-Oriented Programming (OOPS)", code:"OOPS", icon:"💻", builtIn:true},
    {id:"os", name:"Operating System (OS)", code:"OS", icon:"⚙️", builtIn:true},
    {id:"software-engineering", name:"Software Engineering", code:"Software-Engineering", icon:"🛠️", builtIn:true},
    {id:"toc", name:"Theory of Computation (TOC)", code:"TOC", icon:"🧠", builtIn:true}
];

const CS_SUBJECTS = new Set(CS_BUILTIN_SUBJECTS.map(item => item.id));
const CS_CUSTOM_SUBJECTS_FILE = path.join(DATA_DIR, "cs-subjects.json");
const CS_CUSTOM_SUBJECTS = new Map();
let csSubjectRegistryLoaded = false;
let csSubjectRegistryPromise = null;

function readCSCustomSubjects(){
    if(!fs.existsSync(CS_CUSTOM_SUBJECTS_FILE)) return [];
    try{
        const data=JSON.parse(fs.readFileSync(CS_CUSTOM_SUBJECTS_FILE,"utf8"));
        return Array.isArray(data.items)?data.items:[];
    }catch{return [];}
}

function writeCSCustomSubjects(items){
    fs.mkdirSync(DATA_DIR,{recursive:true});
    const temp=`${CS_CUSTOM_SUBJECTS_FILE}.tmp`;
    fs.writeFileSync(temp,JSON.stringify({items},null,2),"utf8");
    fs.renameSync(temp,CS_CUSTOM_SUBJECTS_FILE);
}

function normalizeSubjectId(value){
    return String(value||"").trim().toLowerCase();
}

function subjectSlug(value){
    return String(value||"").trim().toLowerCase()
        .replace(/[^a-z0-9]+/g,"-")
        .replace(/^-+|-+$/g,"")
        .slice(0,80);
}

async function ensureCSSubjectRegistryLoaded(){
    if(csSubjectRegistryLoaded) return;
    if(csSubjectRegistryPromise) return csSubjectRegistryPromise;

    csSubjectRegistryPromise=(async()=>{
        const local=readCSCustomSubjects();
        for(const item of local){
            const id=normalizeSubjectId(item?.id);
            if(id && !CS_SUBJECTS.has(id)) CS_CUSTOM_SUBJECTS.set(id,{...item,id});
        }

        if(firebaseEnabled && db){
            try{
                const snap=await db.collection("csSubjects").get();
                snap.docs.forEach(doc=>{
                    const item=doc.data()||{};
                    const id=normalizeSubjectId(item.id||doc.id);
                    if(id && !CS_SUBJECTS.has(id)) CS_CUSTOM_SUBJECTS.set(id,{...item,id});
                });
            }catch(error){
                console.warn("CS Subject registry Firebase read failed:",error.message);
            }
        }
        csSubjectRegistryLoaded=true;
    })();

    try{await csSubjectRegistryPromise;}finally{csSubjectRegistryPromise=null;}
}

function allCSSubjects(){
    return [
        ...CS_BUILTIN_SUBJECTS,
        ...Array.from(CS_CUSTOM_SUBJECTS.values()).map(item=>({...item,builtIn:false}))
    ];
}

function findCSSubject(value){
    const key=normalizeSubjectId(value);
    if(CS_SUBJECTS.has(key)) return CS_BUILTIN_SUBJECTS.find(item=>item.id===key)||null;
    return CS_CUSTOM_SUBJECTS.get(key)||null;
}

function normalizeCSSubject(subject){
    const value=normalizeSubjectId(subject);
    if(!CS_SUBJECTS.has(value) && !CS_CUSTOM_SUBJECTS.has(value)){
        throw new Error("Computer Science subject valid nahi hai.");
    }
    return value;
}

// Every CS API first loads the persistent custom-subject registry.
app.use("/api/cs", async (req,res,next)=>{
    try{
        await ensureCSSubjectRegistryLoaded();
        next();
    }catch(error){
        res.status(500).json({success:false,message:"Computer Science subject registry load nahi ho payi."});
    }
});

app.get("/api/cs/subjects", async (req,res)=>{
    try{
        await ensureCSSubjectRegistryLoaded();
        res.json({success:true,items:allCSSubjects()});
    }catch(error){
        res.status(500).json({success:false,message:error.message});
    }
});

app.post("/api/cs/subjects", requireOwner, async (req,res)=>{
    try{
        await ensureCSSubjectRegistryLoaded();

        // When Firebase is not connected, cs-subjects.json is the source of truth.
        // Refresh the in-memory custom registry before duplicate validation so a
        // subject removed from the file cannot remain stuck in server memory.
        if(!firebaseEnabled || !db){
            const localSubjects=readCSCustomSubjects();
            CS_CUSTOM_SUBJECTS.clear();
            for(const localItem of localSubjects){
                const localId=normalizeSubjectId(localItem?.id);
                if(localId && !CS_SUBJECTS.has(localId)){
                    CS_CUSTOM_SUBJECTS.set(localId,{...localItem,id:localId});
                }
            }
        }

        const name=String(req.body?.name||"").trim();
        const code=String(req.body?.code||"").trim().toUpperCase();
        const icon=String(req.body?.icon||"📘").trim()||"📘";
        const readd=Boolean(req.body?.readd);

        if(!name) throw new Error("Subject Name daaliye.");
        if(name.length>80) throw new Error("Subject Name bahut lamba hai.");
        if(!/^[A-Z0-9][A-Z0-9_-]{0,24}$/.test(code)) throw new Error("Short Code mein sirf A-Z, 0-9, _ aur - use karein.");
        if(icon.length>8) throw new Error("Icon bahut lamba hai.");

        const id=subjectSlug(name)||subjectSlug(code);
        if(!id) throw new Error("Valid Subject Name dijiye.");

        // Re-add is allowed ONLY when the admin UI explicitly tells the server
        // that this exact code was previously deleted. Normal duplicates remain blocked.
        if(readd){
            const builtinByCode=CS_BUILTIN_SUBJECTS.some(item=>
                String(item.code||"").trim().toLowerCase()===code.toLowerCase()
            );
            if(builtinByCode) throw new Error("Built-in Computer Science subject dobara add nahi kiya ja sakta.");

            const staleIds=new Set();
            for(const [customId,item] of CS_CUSTOM_SUBJECTS.entries()){
                const sameCode=String(item.code||"").trim().toLowerCase()===code.toLowerCase();
                const sameName=String(item.name||"").trim().toLowerCase()===name.toLowerCase();
                const sameId=normalizeSubjectId(customId)===normalizeSubjectId(id);
                if(sameCode||sameName||sameId) staleIds.add(customId);
            }
            staleIds.forEach(oldId=>CS_CUSTOM_SUBJECTS.delete(oldId));
            writeCSCustomSubjects(Array.from(CS_CUSTOM_SUBJECTS.values()));

            if(firebaseEnabled && db){
                try{
                    const snapshot=await db.collection("csSubjects").get();
                    const batch=db.batch();
                    let removed=0;
                    snapshot.docs.forEach(doc=>{
                        const data=doc.data()||{};
                        const sameCode=String(data.code||"").trim().toLowerCase()===code.toLowerCase();
                        const sameName=String(data.name||"").trim().toLowerCase()===name.toLowerCase();
                        const sameId=normalizeSubjectId(data.id||doc.id)===normalizeSubjectId(id);
                        if(sameCode||sameName||sameId){
                            batch.delete(doc.ref);
                            removed++;
                        }
                    });
                    if(removed>0) await batch.commit();
                }catch(error){
                    console.warn("CS Subject stale Firebase cleanup failed:",error.message);
                }
            }
        }else{
            const duplicate=allCSSubjects().some(item=>
                String(item.code||"").toLowerCase()===code.toLowerCase() ||
                String(item.name||"").trim().toLowerCase()===name.toLowerCase()
            );
            if(duplicate) throw new Error("Ye Subject ya Short Code already maujood hai.");

            if(CS_SUBJECTS.has(id) || CS_CUSTOM_SUBJECTS.has(id)){
                throw new Error("Is Subject Name ka ID already maujood hai.");
            }
        }

        const item={id,name,code,icon,createdAt:new Date().toISOString(),source:"admin"};
        CS_CUSTOM_SUBJECTS.set(id,item);
        writeCSCustomSubjects(Array.from(CS_CUSTOM_SUBJECTS.values()));

        // Every Subject must immediately have the same internal Course/Chapter
        // bucket used by the existing CS hierarchy. This keeps the existing
        // Main Topic -> Subtopic -> MCQ flow unchanged for newly added Subjects.
        const chapters=readCSChapters();
        const hasChapter=chapters.some(ch =>
            String(ch.subject).toLowerCase()===id && Number(ch.number)===1
        );
        if(!hasChapter){
            chapters.push({
                id:`${id}-1`,
                subject:id,
                number:1,
                title:name,
                chapterTitle:name,
                updatedAt:new Date().toISOString()
            });
            writeCSChapters(chapters);
        }

        let firebaseSaved=false;
        if(firebaseEnabled && db){
            try{
                await db.collection("csSubjects").doc(id).set(item,{merge:true});
                firebaseSaved=true;
            }catch(error){
                console.warn("CS Subject Firebase save failed; local copy kept:",error.message);
            }
        }

        res.json({success:true,item,firebaseSaved});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.delete("/api/cs/subjects", requireOwner, async (req,res)=>{
    try{
        await ensureCSSubjectRegistryLoaded();
        const id=normalizeSubjectId(req.body?.id);
        const exactName=String(req.body?.name||"").trim();
        if(!id || !exactName) throw new Error("Subject ID aur exact Subject Name required hai.");

        if(CS_SUBJECTS.has(id)){
            return res.status(403).json({success:false,message:"Built-in Computer Science subject delete nahi kiya ja sakta."});
        }

        const subject=CS_CUSTOM_SUBJECTS.get(id);
        if(!subject) return res.status(404).json({success:false,message:"Custom Subject nahi mila."});
        if(exactName!==String(subject.name||"")){
            return res.status(403).json({success:false,message:"Exact Subject Name match nahi hua. Delete blocked."});
        }

        CS_CUSTOM_SUBJECTS.delete(id);
        writeCSCustomSubjects(Array.from(CS_CUSTOM_SUBJECTS.values()));

        let firebaseDeleted=false;
        if(firebaseEnabled && db){
            try{
                // Delete the normal document first.
                const ref=db.collection("csSubjects").doc(id);
                const snap=await ref.get();
                if(snap.exists){
                    await ref.delete();
                    firebaseDeleted=true;
                }

                // Also clean up any older/duplicate registry documents whose
                // stored id/name/code matches this Subject. This prevents a
                // deleted Subject from being reported as a duplicate when it
                // is added again later.
                const snapshot=await db.collection("csSubjects").get();
                const batch=db.batch();
                let extraDeletes=0;
                snapshot.docs.forEach(doc=>{
                    const data=doc.data()||{};
                    const sameId=normalizeSubjectId(data.id)===id;
                    const sameName=String(data.name||"").trim().toLowerCase()===
                        String(subject.name||"").trim().toLowerCase();
                    const sameCode=String(data.code||"").trim().toLowerCase()===
                        String(subject.code||"").trim().toLowerCase();

                    if((sameId||sameName||sameCode) && doc.id!==id){
                        batch.delete(doc.ref);
                        extraDeletes++;
                    }
                });

                if(extraDeletes>0){
                    await batch.commit();
                    firebaseDeleted=true;
                }
            }catch(error){
                console.warn("CS Subject Firebase delete failed:",error.message);
            }
        }

        res.json({success:true,message:`${subject.name} delete ho gaya.`,firebaseDeleted});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

function readCSChapters(){
    if(!fs.existsSync(CS_CHAPTERS_FILE)) return [];
    try{
        const data=JSON.parse(fs.readFileSync(CS_CHAPTERS_FILE,"utf8"));
        return Array.isArray(data.items)?data.items:[];
    }catch{return [];}
}

function writeCSChapters(items){
    fs.mkdirSync(DATA_DIR,{recursive:true});
    const temp=`${CS_CHAPTERS_FILE}.tmp`;
    fs.writeFileSync(temp,JSON.stringify({items},null,2),"utf8");
    fs.renameSync(temp,CS_CHAPTERS_FILE);
}

function getCSChapter(subject,chapterNumber){
    const sub=normalizeCSSubject(subject);
    const number=Number(chapterNumber);
    if(!Number.isInteger(number)||number<1||number>100) throw new Error("Invalid chapter number.");
    return readCSChapters().find(item=>
        String(item.subject).toLowerCase()===sub && Number(item.number)===number
    )||null;
}

app.get("/api/cs/chapters/:subject",async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.params.subject);
        const items=readCSChapters()
            .filter(item=>String(item.subject).toLowerCase()===subject)
            .sort((a,b)=>Number(a.number)-Number(b.number));
        res.json({success:true,items});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.get("/api/cs/chapters/:subject/:chapterNumber",async(req,res)=>{
    try{
        const chapter=getCSChapter(req.params.subject,req.params.chapterNumber);
        res.json({success:true,exists:Boolean(chapter),chapter});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.post("/api/cs/chapters",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const title=String(req.body.chapterTitle||"").trim();
        if(!title) throw new Error("Chapter Title daaliye.");

        const items=readCSChapters();
        const existingIndex=items.findIndex(item =>
            String(item.subject).toLowerCase()===subject &&
            String(item.title||item.chapterTitle||"").trim().toLowerCase()===title.toLowerCase()
        );

        if(existingIndex>=0){
            return res.json({success:true,chapter:items[existingIndex]});
        }

        const used=new Set(
            items.filter(item=>String(item.subject).toLowerCase()===subject)
                 .map(item=>Number(item.number))
        );
        let number=1;
        while(used.has(number)) number++;
        if(number>100) throw new Error("Maximum 100 chapters allowed.");

        const item={
            id:`${subject}-${number}`,
            subject,
            number,
            title,
            chapterTitle:title,
            updatedAt:new Date().toISOString()
        };
        items.push(item);
        writeCSChapters(items);
        res.json({success:true,chapter:item});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.delete("/api/cs/chapters",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const number=Number(req.body.chapterNumber);
        const items=readCSChapters();
        const next=items.filter(item=>!(String(item.subject).toLowerCase()===subject&&Number(item.number)===number));
        if(next.length===items.length){
            return res.status(404).json({success:false,message:"Chapter nahi mila."});
        }
        writeCSChapters(next);
        res.json({success:true});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});


/* ======================================================
   COMPUTER SCIENCE SUBTOPIC REGISTRY
   Hierarchy:
   Subject -> Main Topic / Chapter -> Subtopic -> MCQ
   Existing Chapter + MCQ APIs are kept unchanged.
====================================================== */

const CS_SUBTOPICS_FILE = path.join(DATA_DIR, "cs-subtopics.json");

function readCSSubtopics() {
    if (!fs.existsSync(CS_SUBTOPICS_FILE)) return [];

    try {
        const data = JSON.parse(
            fs.readFileSync(CS_SUBTOPICS_FILE, "utf8")
        );

        return Array.isArray(data.items) ? data.items : [];
    } catch {
        return [];
    }
}

function writeCSSubtopics(items) {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const temp = `${CS_SUBTOPICS_FILE}.tmp`;

    fs.writeFileSync(
        temp,
        JSON.stringify({ items }, null, 2),
        "utf8"
    );

    fs.renameSync(temp, CS_SUBTOPICS_FILE);
}

async function getFirebaseCSSubtopics() {
    if (!firebaseEnabled || !db) return [];

    const snapshot = await db
        .collection("csSubtopics")
        .get();

    return snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
    }));
}

async function saveFirebaseCSSubtopic(item) {
    if (!firebaseEnabled || !db) return false;

    await db
        .collection("csSubtopics")
        .doc(item.id)
        .set(item, { merge: true });

    return true;
}

async function deleteFirebaseCSSubtopic(id) {
    if (!firebaseEnabled || !db) return false;

    const ref = db
        .collection("csSubtopics")
        .doc(String(id));

    const snapshot = await ref.get();

    if (!snapshot.exists) return false;

    await ref.delete();
    return true;
}

/* ------------------------------------------------------
   GET SUBTOPICS
   Subject + Main Topic / Chapter
------------------------------------------------------ */

app.get(
    "/api/cs/subtopics/:subject/:chapterNumber",
    async (req, res) => {
        try {
            const subject =
                normalizeCSSubject(req.params.subject);

            const chapterNumber =
                Number(req.params.chapterNumber);

            const chapter =
                getCSChapter(subject, chapterNumber);

            if (!chapter) {
                return res.status(404).json({
                    success: false,
                    message: "Main Topic / Chapter nahi mila."
                });
            }

            // IMPORTANT:
            // A Main Topic is a chapter. Only records belonging to the
            // selected Main Topic are shown as its Subtopics.
            // If an old subtopic record has the exact title of another
            // Main Topic, it must not appear as a Subtopic.
            const mainTopics = readCSChapters().filter(item =>
                String(item.subject).toLowerCase() === subject
            );

            const mainTopicTitles = new Set(
                mainTopics.map(item =>
                    String(item.title || item.chapterTitle || "")
                        .trim()
                        .toLowerCase()
                )
            );

            const isValidSubtopic = item =>
                item &&
                String(item.subject).toLowerCase() === subject &&
                Number(item.chapterNumber) === chapterNumber &&
                !mainTopicTitles.has(
                    String(item.title || "").trim().toLowerCase()
                );

            const localItems =
                readCSSubtopics().filter(isValidSubtopic);

            let firebaseItems = [];

            if (firebaseEnabled && db) {
                try {
                    firebaseItems =
                        (await getFirebaseCSSubtopics())
                            .filter(isValidSubtopic);
                } catch (error) {
                    console.warn(
                        "CS Subtopic Firebase read failed:",
                        error.message
                    );
                }
            }

            const merged = new Map();

            localItems.forEach(item => {
                merged.set(String(item.id), item);
            });

            firebaseItems.forEach(item => {
                merged.set(String(item.id), item);
            });

            const items =
                Array.from(merged.values())
                    .sort((a, b) =>
                        String(a.title || "")
                            .localeCompare(
                                String(b.title || ""),
                                undefined,
                                { sensitivity: "base" }
                            )
                    );

            res.json({
                success: true,
                subject,
                chapterNumber,
                chapter,
                items
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
);


/* ------------------------------------------------------
   PUBLIC MAIN TOPIC -> SUBTOPIC HIERARCHY
------------------------------------------------------ */

app.get("/api/cs/main-topics/:subject", async (req, res) => {
    try {
        const subject = normalizeCSSubject(req.params.subject);

        const mainTopics = readCSChapters()
            .filter(item =>
                String(item.subject).toLowerCase() === subject
            )
            .sort((a, b) => Number(a.number) - Number(b.number));

        const allSubtopics = readCSSubtopics()
            .filter(item =>
                String(item.subject).toLowerCase() === subject
            );

        const mainTopicTitles = new Set(
            mainTopics.map(item =>
                String(item.title || item.chapterTitle || "")
                    .trim()
                    .toLowerCase()
            )
        );

        const items = mainTopics.map(topic => ({
            ...topic,
            subtopics: allSubtopics
                .filter(subtopic =>
                    Number(subtopic.chapterNumber) === Number(topic.number) &&
                    !mainTopicTitles.has(
                        String(subtopic.title || "").trim().toLowerCase()
                    )
                )
                .sort((a, b) =>
                    String(a.title || "").localeCompare(
                        String(b.title || ""),
                        undefined,
                        { sensitivity: "base" }
                    )
                )
        }));

        res.json({
            success: true,
            subject,
            items
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});


/* ------------------------------------------------------
   CREATE / SAVE SUBTOPIC
------------------------------------------------------ */

app.post(
    "/api/cs/subtopics",
    requireOwner,
    async (req, res) => {
        try {
            const subject =
                normalizeCSSubject(req.body.subject);

            const chapterNumber =
                Number(req.body.chapterNumber);

            const chapter =
                getCSChapter(subject, chapterNumber);

            if (!chapter) {
                return res.status(404).json({
                    success: false,
                    message: "Pehle Main Topic / Chapter save karo."
                });
            }

            const title =
                String(req.body.title || "")
                    .trim();

            if (!title) {
                throw new Error(
                    "Subtopic Title daaliye."
                );
            }

            if (title.length > 200) {
                throw new Error(
                    "Subtopic Title bahut lamba hai."
                );
            }

            const items = readCSSubtopics();

            const existing =
                items.find(item =>
                    String(item.subject).toLowerCase() === subject &&
                    Number(item.chapterNumber) === chapterNumber &&
                    String(item.title || "").trim().toLowerCase() === title.toLowerCase()
                );

            if (existing) {
                return res.json({
                    success: true,
                    message: "Subtopic already saved hai.",
                    item: existing
                });
            }

            const now =
                new Date().toISOString();

            const item = {
                id:
                    `cs-sub-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`,
                subject,
                chapterNumber,
                title,
                createdAt: now,
                updatedAt: now,
                source: "admin"
            };

            items.push(item);
            writeCSSubtopics(items);

            let firebaseSaved = false;

            if (firebaseEnabled && db) {
                try {
                    firebaseSaved =
                        await saveFirebaseCSSubtopic(item);
                } catch (error) {
                    console.warn(
                        "CS Subtopic Firebase save failed; local copy kept:",
                        error.message
                    );
                }
            }

            res.json({
                success: true,
                message: firebaseSaved
                    ? "Subtopic Firebase Firestore mein save ho gaya."
                    : "Subtopic local storage mein save ho gaya.",
                item,
                firebaseSaved
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
);

/* ------------------------------------------------------
   RENAME SUBTOPIC
------------------------------------------------------ */

app.patch(
    "/api/cs/subtopics/rename",
    requireOwner,
    async (req, res) => {
        try {
            const subject =
                normalizeCSSubject(req.body.subject);

            const chapterNumber =
                Number(req.body.chapterNumber);

            const id =
                String(req.body.id || "").trim();

            const newTitle =
                String(req.body.newTitle || "").trim();

            if (!id || !newTitle) {
                throw new Error(
                    "Subtopic ID aur new title required hai."
                );
            }

            if (newTitle.length > 200) {
                throw new Error(
                    "Subtopic Title bahut lamba hai."
                );
            }

            const items = readCSSubtopics();

            const index =
                items.findIndex(item =>
                    String(item.id) === id &&
                    String(item.subject).toLowerCase() === subject &&
                    Number(item.chapterNumber) === chapterNumber
                );

            if (index < 0) {
                return res.status(404).json({
                    success: false,
                    message: "Subtopic nahi mila."
                });
            }

            const duplicate =
                items.some(item =>
                    String(item.id) !== id &&
                    String(item.subject).toLowerCase() === subject &&
                    Number(item.chapterNumber) === chapterNumber &&
                    String(item.title || "").trim().toLowerCase() === newTitle.toLowerCase()
                );

            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    message: "Is naam ka Subtopic already hai."
                });
            }

            items[index].title = newTitle;
            items[index].updatedAt =
                new Date().toISOString();

            writeCSSubtopics(items);

            let firebaseUpdated = false;

            if (firebaseEnabled && db) {
                try {
                    firebaseUpdated =
                        await saveFirebaseCSSubtopic(items[index]);
                } catch (error) {
                    console.warn(
                        "CS Subtopic Firebase rename failed:",
                        error.message
                    );
                }
            }

            res.json({
                success: true,
                message: firebaseUpdated
                    ? "Subtopic Firebase mein bhi rename ho gaya."
                    : "Subtopic rename ho gaya.",
                item: items[index],
                firebaseUpdated
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
);

/* ------------------------------------------------------
   DELETE SUBTOPIC
   NOTE: This only deletes the Subtopic registry entry.
   Existing MCQ files are NOT deleted.
------------------------------------------------------ */

app.delete(
    "/api/cs/subtopics",
    requireOwner,
    async (req, res) => {
        try {
            const subject =
                normalizeCSSubject(req.body.subject);

            const chapterNumber =
                Number(req.body.chapterNumber);

            const id =
                String(req.body.id || "").trim();

            if (!id) {
                throw new Error(
                    "Subtopic ID required hai."
                );
            }

            const items = readCSSubtopics();

            const item =
                items.find(existing =>
                    String(existing.id) === id &&
                    String(existing.subject).toLowerCase() === subject &&
                    Number(existing.chapterNumber) === chapterNumber
                );

            if (!item) {
                return res.status(404).json({
                    success: false,
                    message: "Subtopic nahi mila."
                });
            }

            writeCSSubtopics(
                items.filter(existing =>
                    String(existing.id) !== id
                )
            );

            let firebaseDeleted = false;

            if (firebaseEnabled && db) {
                try {
                    firebaseDeleted =
                        await deleteFirebaseCSSubtopic(id);
                } catch (error) {
                    console.warn(
                        "CS Subtopic Firebase delete failed:",
                        error.message
                    );
                }
            }

            res.json({
                success: true,
                message: firebaseDeleted
                    ? "Subtopic Firestore aur local registry dono se delete ho gaya."
                    : "Subtopic local registry se delete ho gaya.",
                firebaseDeleted
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
);

/* ======================================================
   COMPUTER SCIENCE MCQ HTML + NOTES
====================================================== */

const CS_MCQ_ROOT = path.join(DATA_DIR, "cs", "MCQ");
const CS_NOTES_FILE = path.join(DATA_DIR, "cs-subject-notes.json");

function csChapterDir(subject, chapterNumber) {
    const sub = normalizeCSSubject(subject);
    const number = Number(chapterNumber);
    if (!Number.isInteger(number) || number < 1 || number > 100) {
        throw new Error("Invalid chapter number.");
    }
    return path.join(CS_MCQ_ROOT, sub, `chapter-${String(number).padStart(2,"0")}`);
}

function readCSMCQMetadata(subject, chapterNumber) {
    const file=path.join(csChapterDir(subject,chapterNumber),"index.json");
    if(!fs.existsSync(file)) return [];
    try {
        const data=JSON.parse(fs.readFileSync(file,"utf8"));
        return Array.isArray(data.items)?data.items:[];
    } catch { return []; }
}

function writeCSMCQMetadata(subject, chapterNumber, items) {
    const dir=csChapterDir(subject,chapterNumber);
    fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,"index.json");
    const temp=`${file}.tmp`;
    fs.writeFileSync(temp,JSON.stringify({items},null,2),"utf8");
    fs.renameSync(temp,file);
}

function readCSNotes() {
    if(!fs.existsSync(CS_NOTES_FILE)) return {};
    try {
        const data=JSON.parse(fs.readFileSync(CS_NOTES_FILE,"utf8"));
        return data && typeof data==="object" ? data : {};
    } catch { return {}; }
}

function writeCSNotes(data) {
    fs.mkdirSync(DATA_DIR,{recursive:true});
    const temp=`${CS_NOTES_FILE}.tmp`;
    fs.writeFileSync(temp,JSON.stringify(data,null,2),"utf8");
    fs.renameSync(temp,CS_NOTES_FILE);
}

const mcqHTMLUpload =
    multer({
        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                50 * 1024 * 1024
        },

        fileFilter:
            (req, file, cb) => {
                const ext =
                    path.extname(
                        file.originalname
                    ).toLowerCase();

                if (
                    ![
                        ".html",
                        ".htm"
                    ].includes(ext)
                ) {
                    return cb(
                        new Error(
                            "Sirf .html ya .htm MCQ file upload karo."
                        )
                    );
                }

                cb(null, true);
            }
    });


app.post("/api/cs/mcq-html/upload",requireOwner,mcqHTMLUpload.single("mcqFile"),async(req,res)=>{
    try{
        if(!req.file) return res.status(400).json({success:false,message:"MCQ HTML file select karo."});
        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const chapter=getCSChapter(subject,chapterNumber);
        if(!chapter) return res.status(404).json({success:false,message:"Pehle chapter save/select karo."});

        const html=req.file.buffer.toString("utf8");
        if(!html.trim()) throw new Error("HTML file empty hai.");

        const questionCount=questionCountFromHTML(html);
        const title=htmlTitle(html)||path.basename(req.file.originalname,path.extname(req.file.originalname));
        const id=`cs-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
        const fileName=`mcq-${id}.html`;
        const now=new Date().toISOString();

        // Subtopic is optional so every existing MCQ upload remains compatible.
        const requestedSubtopicId=String(req.body.subtopicId||"").trim();
        let subtopicId=null;

        if(requestedSubtopicId){
            const subtopics=readCSSubtopics();
            const matched=subtopics.find(item =>
                String(item.id)===requestedSubtopicId &&
                String(item.subject).toLowerCase()===subject &&
                Number(item.chapterNumber)===chapterNumber
            );

            if(!matched){
                throw new Error("Selected subtopic is not valid for this Main Topic.");
            }

            subtopicId=matched.id;
        }

        const item={
            id,fileName,originalName:req.file.originalname,name:title,questionCount,
            subtopicId,
            createdAt:now,updatedAt:now,
            url:`/api/cs/mcq-html/file/${encodeURIComponent(id)}`
        };

        const dir=csChapterDir(subject,chapterNumber);
        fs.mkdirSync(dir,{recursive:true});
        fs.writeFileSync(path.join(dir,fileName),html,"utf8");

        const items=readCSMCQMetadata(subject,chapterNumber);
        items.push(item);
        writeCSMCQMetadata(subject,chapterNumber,items);

        if(firebaseEnabled&&db){
            try{
                await saveHTMLToFirebase({classNumber:0,subject,chapterNumber,subtopicId},item,html);
            }catch(error){
                console.warn("CS Firestore MCQ save failed; local copy kept:",error.message);
            }
        }

        res.json({success:true,item});
    }catch(error){
        console.error("CS MCQ upload error:",error);
        res.status(400).json({success:false,message:error.message||"MCQ upload failed."});
    }
});

app.get("/api/cs/mcq-html/file/:id",async(req,res)=>{
    const id=String(req.params.id||"");
    try{
        if(firebaseEnabled&&db){
            const data=await getHTMLFromFirebase(id);
            if(data&&typeof data.html==="string"){
                res.type("html").send(data.html);
                return;
            }
        }
    }catch(error){console.warn("CS Firebase MCQ read failed:",error.message);}

    const root=path.resolve(CS_MCQ_ROOT);
    if(fs.existsSync(root)){
        const subjectDirs=fs.readdirSync(root,{withFileTypes:true});
        for(const sd of subjectDirs){
            if(!sd.isDirectory()) continue;
            const subject=sd.name;
            const subjectRoot=path.join(root,subject);
            const chapterDirs=fs.readdirSync(subjectRoot,{withFileTypes:true});
            for(const cd of chapterDirs){
                if(!cd.isDirectory()) continue;
                const n=Number(cd.name.replace("chapter-",""));
                const items=readCSMCQMetadata(subject,n);
                const item=items.find(x=>x.id===id);
                if(!item) continue;
                const file=path.join(subjectRoot,cd.name,item.fileName);
                if(fs.existsSync(file)){
                    res.sendFile(path.resolve(file));
                    return;
                }
            }
        }
    }
    res.status(404).send("MCQ file not found.");
});

app.get("/api/cs/mcq-html/:subject/:chapterNumber",async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.params.subject);
        const chapterNumber=Number(req.params.chapterNumber);
        const requestedSubtopicId=String(req.query.subtopicId||"").trim();

        const localItems=readCSMCQMetadata(subject,chapterNumber);
        let firebaseItems=[];
        if(firebaseEnabled&&db){
            try{firebaseItems=await listHTMLFromFirestore(0,subject,chapterNumber);}catch{}
        }

        const merged=[];
        const seen=new Set();

        for(const item of [...localItems,...firebaseItems]){
            if(!item||!item.id||seen.has(item.id)) continue;

            // If a subtopic is selected, return only MCQs linked to it.
            // With no subtopicId, preserve the old chapter-wide behaviour.
            if(requestedSubtopicId &&
               String(item.subtopicId||"")!==requestedSubtopicId){
                continue;
            }

            seen.add(item.id);
            merged.push({...item,url:`/api/cs/mcq-html/file/${encodeURIComponent(item.id)}`});
        }

        res.json({
            success:true,
            items:merged,
            subtopicId:requestedSubtopicId||null
        });
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.patch("/api/cs/mcq-html/rename",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const id=String(req.body.id||"");
        const newName=String(req.body.newName||"").trim();
        if(!id||!newName) throw new Error("Quiz ID aur new name required hai.");

        const items=readCSMCQMetadata(subject,chapterNumber);
        const index=items.findIndex(item=>item.id===id);
        if(index<0) return res.status(404).json({success:false,message:"MCQ nahi mila."});

        items[index].name=newName;
        items[index].updatedAt=new Date().toISOString();
        writeCSMCQMetadata(subject,chapterNumber,items);

        if(firebaseEnabled&&db){
            try{await renameHTMLInFirebase({classNumber:0,subject,chapterNumber},id,items[index].fileName,newName);}catch{}
        }
        res.json({success:true});
    }catch(error){res.status(400).json({success:false,message:error.message});}
});

app.delete("/api/cs/mcq-html",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const id=String(req.body.id||"");
        const items=readCSMCQMetadata(subject,chapterNumber);
        const item=items.find(x=>x.id===id);
        if(!item) return res.status(404).json({success:false,message:"MCQ nahi mila."});

        writeCSMCQMetadata(subject,chapterNumber,items.filter(x=>x.id!==id));

        const file=path.join(csChapterDir(subject,chapterNumber),item.fileName);
        if(fs.existsSync(file)) fs.unlinkSync(file);
        if(firebaseEnabled&&db){try{await deleteHTMLFromFirebase(id);}catch{}}

        res.json({success:true});
    }catch(error){res.status(400).json({success:false,message:error.message});}
});

app.get("/api/cs/subject-notes/:subject",async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.params.subject);
        const notes=readCSNotes();
        const notesUrl=String(notes[subject]||"");
        res.json({success:true,exists:Boolean(notesUrl),notesUrl});
    }catch(error){res.status(400).json({success:false,message:error.message});}
});

app.post("/api/cs/subject-notes",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const notesUrl=String(req.body.notesUrl||"").trim();
        if(!/^https:\/\/(drive\.google\.com|docs\.google\.com)\//i.test(notesUrl)){
            throw new Error("Valid Google Drive ya Google Docs link dijiye.");
        }
        const notes=readCSNotes();
        notes[subject]=notesUrl;
        writeCSNotes(notes);
        res.json({success:true,notesUrl});
    }catch(error){res.status(400).json({success:false,message:error.message});}
});

app.delete("/api/cs/subject-notes",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const notes=readCSNotes();
        delete notes[subject];
        writeCSNotes(notes);
        res.json({success:true});
    }catch(error){res.status(400).json({success:false,message:error.message});}
});

/* ======================================================
   CHAPTER LIST / CREATE API
====================================================== */

app.get(
    "/api/chapters/:classNumber/:subject",
    async (req, res) => {
        try {
            const items = await listChapters(
                req.params.classNumber,
                req.params.subject
            );

            res.json({
                success: true,
                items
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
);

app.post(
    "/api/chapters",
    requireOwner,
    async (req, res) => {
        try {
            const info = validateMCQLocation(
                req.body.classNumber,
                req.body.subject,
                req.body.chapterNumber
            );

            const title = String(
                req.body.chapterTitle || ""
            ).trim();

            if (!title) {
                return res.status(400).json({
                    success: false,
                    message: "Chapter Title required hai."
                });
            }

            if (title.length > 200) {
                return res.status(400).json({
                    success: false,
                    message: "Chapter Title bahut lamba hai."
                });
            }

            const id = chapterDocId(
                info.classNumber,
                info.subject,
                info.chapterNumber
            );

            const item = {
                id,
                classNumber: info.classNumber,
                subject: info.subject,
                number: info.chapterNumber,
                title,
                updatedAt: new Date().toISOString(),
                source: "admin"
            };

            const local = readLocalChapters();
            const index = local.findIndex(x => x.id === id);

            if (index >= 0) {
                local[index] = { ...local[index], ...item };
            } else {
                local.push({ ...item, createdAt: new Date().toISOString() });
            }

            writeLocalChapters(local);

            let firebaseSaved = false;
            if (firebaseEnabled && db) {
                await db.collection("chapters").doc(id).set(
                    { ...item, createdAt: new Date().toISOString() },
                    { merge: true }
                );
                firebaseSaved = true;
            }

            res.json({
                success: true,
                message: firebaseSaved
                    ? "Chapter Firebase Firestore mein save ho gaya."
                    : "Chapter local storage mein save ho gaya.",
                item,
                firebaseSaved
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
);


/* ======================================================
   CHAPTER DELETE API
====================================================== */

app.delete(
    "/api/chapters",
    requireOwner,
    async (req, res) => {
        try {
            const info = validateMCQLocation(
                req.body.classNumber,
                req.body.subject,
                req.body.chapterNumber
            );

            const id = chapterDocId(
                info.classNumber,
                info.subject,
                info.chapterNumber
            );

            const local = readLocalChapters();
            const localExists = local.some(item => item.id === id);

            const firebaseExists =
                firebaseEnabled &&
                db
                    ? (
                        await db
                            .collection("chapters")
                            .doc(id)
                            .get()
                    ).exists
                    : false;

            if (!localExists && !firebaseExists) {
                return res.status(404).json({
                    success: false,
                    message: `Chapter ${info.chapterNumber} saved nahi hai.`
                });
            }

            if (localExists) {
                writeLocalChapters(
                    local.filter(item => item.id !== id)
                );
            }

            let firebaseDeleted = false;

            if (firebaseExists) {
                await db
                    .collection("chapters")
                    .doc(id)
                    .delete();

                firebaseDeleted = true;
            }

            res.json({
                success: true,
                message: firebaseDeleted
                    ? `Chapter ${info.chapterNumber} Firebase Firestore aur local registry se delete ho gaya.`
                    : `Chapter ${info.chapterNumber} local registry se delete ho gaya.`,
                firebaseDeleted
            });
        } catch (error) {
            console.error("Chapter delete error:", error);

            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
);

/* ======================================================
   MCQ LIST API
====================================================== */

app.get(
    "/api/mcq-html/:classNumber/:subject/:chapterNumber",
    async (req, res) => {
        try {
            const info =
                validateMCQLocation(
                    req.params.classNumber,
                    req.params.subject,
                    req.params.chapterNumber
                );

            const localItems = publicItems(
                info.classNumber,
                info.subject,
                info.chapterNumber
            );

            const firebaseItems = firebaseEnabled
                ? await listHTMLFromFirestore(
                    info.classNumber,
                    info.subject,
                    info.chapterNumber
                )
                : [];

            const merged = new Map();

            localItems.forEach(item => merged.set(item.id, item));
            firebaseItems.forEach(item => merged.set(item.id, item));

            // Old Local + Firebase copies can have different IDs but the
            // same visible quiz. Keep only one copy in Admin.
            const unique = new Map();
            Array.from(merged.values()).forEach(item => {
                const signature = [
                    String(item.name || item.originalName || item.fileName || "")
                        .trim()
                        .toLowerCase(),
                    Number(item.questionCount || 0)
                ].join("|");

                const existing = unique.get(signature);
                if (!existing || item.source === "firebase-firestore") {
                    unique.set(signature, item);
                }
            });

            res.json({
                success: true,
                items: Array.from(unique.values())
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);

/* ======================================================
   HTML MCQ FILE VIEW / FIREBASE FALLBACK
====================================================== */

app.get(
    "/api/mcq-html/file/:id",
    async (req, res) => {
        try {
            const id = String(req.params.id || "").trim();

            if (!id) {
                return res.status(400).send("MCQ file id required.");
            }

            const firebaseItem = firebaseEnabled
                ? await getHTMLFromFirebase(id)
                : null;

            if (firebaseItem && typeof firebaseItem.html === "string") {
                res.type("html").send(firebaseItem.html);
                return;
            }

            const classNumber = Number(firebaseItem?.classNumber);
            const subject = String(firebaseItem?.subject || "");
            const chapterNumber = Number(firebaseItem?.chapterNumber);

            if (
                Number.isInteger(classNumber) &&
                subject &&
                Number.isInteger(chapterNumber)
            ) {
                const dir = chapterDir(
                    classNumber,
                    subject,
                    chapterNumber
                );
                const filePath = path.join(
                    dir,
                    firebaseItem.fileName
                );

                if (fs.existsSync(filePath)) {
                    return res.sendFile(filePath);
                }
            }

            // Local metadata fallback when Firebase is unavailable.
            const classDirs = fs.existsSync(DATA_DIR)
                ? fs.readdirSync(DATA_DIR).filter(name => /^class\d+$/.test(name))
                : [];

            for (const classDirName of classDirs) {
                const cls = Number(classDirName.replace("class", ""));
                if (!Number.isInteger(cls)) continue;

                for (const sub of ["Physics", "Chemistry", "Biology", "Environmental-Science"]) {
                    for (let ch = 1; ch <= 100; ch++) {
                        const dir = chapterDir(cls, sub, ch);
                        const item = readMetadata(dir).find(x => x.id === id);
                        if (!item) continue;

                        const filePath = path.join(dir, item.fileName);
                        if (fs.existsSync(filePath)) {
                            return res.sendFile(filePath);
                        }
                    }
                }
            }

            return res.status(404).send("MCQ file nahi mila.");
        } catch (error) {
            console.error("MCQ HTML file error:", error);
            res.status(500).send(error.message || "MCQ file error.");
        }
    }
);

/* ======================================================
   MULTER
====================================================== */


/* ======================================================
   NEW HTML MCQ UPLOAD
====================================================== */

app.post(
    "/api/mcq-html/upload",
    requireOwner,
    mcqHTMLUpload.single("mcqFile"),

    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message:
                        "MCQ HTML file select karo."
                });
            }

            const info =
                validateMCQLocation(
                    req.body.classNumber,
                    req.body.subject,
                    req.body.chapterNumber
                );

            const html =
                req.file.buffer.toString(
                    "utf8"
                );

            if (!html.trim()) {
                return res.status(400).json({
                    success: false,
                    message:
                        "HTML file empty hai."
                });
            }

            const questionCount =
                questionCountFromHTML(
                    html
                );

            const title =
                htmlTitle(html) ||
                path.basename(
                    req.file.originalname,
                    path.extname(
                        req.file.originalname
                    )
                );

            const id =
                `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

            const fileName =
                `mcq-${id}.html`;

            const now =
                new Date().toISOString();

            const item = {
                id,
                fileName,
                originalName:
                    req.file.originalname,
                name: title,
                questionCount,
                createdAt: now,
                updatedAt: now,
                url:
                    `/api/mcq-html/file/${encodeURIComponent(id)}`
            };

            // HTML ka permanent copy Firestore mein save hota hai.
            let firebaseSaved = false;

            if (firebaseEnabled) {
                firebaseSaved = await saveHTMLToFirebase(
                    info,
                    item,
                    html
                );
            }

            // Local copy bhi rakho, taaki current server par existing workflow same rahe.
            const dir = chapterDir(
                info.classNumber,
                info.subject,
                info.chapterNumber
            );

            fs.mkdirSync(dir, { recursive: true });

            const filePath = path.join(dir, fileName);
            const tempPath = `${filePath}.tmp`;

            fs.writeFileSync(tempPath, html, "utf8");
            fs.renameSync(tempPath, filePath);

            const items = readMetadata(dir);
            items.push({ ...item });
            writeMetadata(dir, items);

            res.json({
                success: true,
                message: firebaseSaved
                    ? `${questionCount} MCQ upload ho gaye aur Firebase Firestore mein permanently save ho gaye.`
                    : `${questionCount} MCQ upload ho gaye. Firebase credentials available nahi hain.`,
                item,
                firebaseSaved
            });
        } catch (error) {
            console.error(
                "MCQ upload error:",
                error
            );

            res.status(400).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);

/* ======================================================
   RENAME MCQ
====================================================== */

app.patch(
    "/api/mcq-html/rename",
    requireOwner,

    async (req, res) => {
        try {
            const info =
                validateMCQLocation(
                    req.body.classNumber,
                    req.body.subject,
                    req.body.chapterNumber
                );

            const id =
                String(
                    req.body.id || ""
                ).trim();

            const newName =
                sanitizeFileBaseName(
                    req.body.newName
                );

            const dir =
                chapterDir(
                    info.classNumber,
                    info.subject,
                    info.chapterNumber
                );

            const items =
                readMetadata(dir);

            const index =
                items.findIndex(
                    item =>
                        item.id === id
                );

            if (index === -1) {
                if (firebaseEnabled) {
                    const firebaseItem = await getHTMLFromFirebase(id);

                    if (firebaseItem) {
                        const updatedFileName = `${newName}.html`;
                        await renameHTMLInFirebase(
                            info,
                            id,
                            updatedFileName,
                            newName
                        );

                        return res.json({
                            success: true,
                            message: "MCQ file name Firebase Firestore mein update ho gaya.",
                            item: {
                                ...firebaseItem,
                                fileName: updatedFileName,
                                name: newName,
                                url: `/api/mcq-html/file/${encodeURIComponent(id)}`
                            },
                            firebaseUpdated: true
                        });
                    }
                }

                return res.status(404).json({
                    success: false,
                    message: "MCQ file nahi mila."
                });
            }

            const oldFileName =
                items[index].fileName;

            const newFileName =
                `${newName}.html`;

            const oldPath =
                path.join(
                    dir,
                    oldFileName
                );

            const newPath =
                path.join(
                    dir,
                    newFileName
                );

            if (!fs.existsSync(oldPath)) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "Original MCQ HTML file nahi mila."
                    });
            }

            if (
                oldFileName.toLowerCase() !==
                    newFileName.toLowerCase() &&
                fs.existsSync(newPath)
            ) {
                return res
                    .status(409)
                    .json({
                        success: false,
                        message:
                            "Is naam ki file already hai."
                    });
            }

            fs.renameSync(
                oldPath,
                newPath
            );

            const oldName = String(items[index].name || "").trim();
            const oldQuestionCount = Number(items[index].questionCount || 0);

            items[index].fileName =
                newFileName;

            items[index].name =
                newName;

            items[index].updatedAt =
                new Date().toISOString();

            writeMetadata(
                dir,
                items
            );

            let firebaseUpdated = false;

            if (firebaseEnabled) {
                firebaseUpdated = await renameHTMLInFirebase(
                    info,
                    id,
                    newFileName,
                    newName
                );
            }

            // If an old local duplicate represents the same Firebase quiz,
            // keep the Admin list clean after rename as well.
            const refreshedItems = readMetadata(dir);
            let duplicateChanged = false;

            refreshedItems.forEach(item => {
                if (
                    item.id !== id &&
                    String(item.name || "").trim() === String(oldName || "").trim() &&
                    Number(item.questionCount || 0) === oldQuestionCount
                ) {
                    item.name = newName;
                    item.updatedAt = new Date().toISOString();
                    duplicateChanged = true;
                }
            });

            if (duplicateChanged) {
                writeMetadata(dir, refreshedItems);
            }

            const item =
                publicItems(
                    info.classNumber,
                    info.subject,
                    info.chapterNumber
                ).find(
                    x => x.id === id
                ) || {
                    id,
                    fileName: newFileName,
                    name: newName,
                    url: `/api/mcq-html/file/${encodeURIComponent(id)}`
                };

            res.json({
                success: true,
                message: firebaseUpdated
                    ? "MCQ file name Firebase mein bhi update ho gaya."
                    : "MCQ file name update ho gaya.",
                item,
                firebaseUpdated
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);

/* ======================================================
   DELETE MCQ
====================================================== */

app.delete(
    "/api/mcq-html",
    requireOwner,

    async (req, res) => {
        try {
            const info =
                validateMCQLocation(
                    req.body.classNumber,
                    req.body.subject,
                    req.body.chapterNumber
                );

            const id =
                String(
                    req.body.id || ""
                ).trim();

            const dir =
                chapterDir(
                    info.classNumber,
                    info.subject,
                    info.chapterNumber
                );

            const items =
                readMetadata(dir);

            const index =
                items.findIndex(
                    item =>
                        item.id === id
                );

            let firebaseExists = false;
            let firebaseDeletedName = "";
            let firebaseDeletedQuestionCount = 0;

            if (firebaseEnabled) {
                const ref = firestoreHTMLRef(id);
                if (ref) {
                    const snapshot = await ref.get();
                    firebaseExists = snapshot.exists;
                    if (snapshot.exists) {
                        const firebaseData = snapshot.data() || {};
                        firebaseDeletedName = String(
                            firebaseData.name || firebaseData.originalName || firebaseData.fileName || ""
                        ).trim();
                        firebaseDeletedQuestionCount = Number(firebaseData.questionCount || 0);
                    }
                }
            }

            if (index === -1 && !firebaseExists) {
                return res.status(404).json({
                    success: false,
                    message: "MCQ file nahi mila."
                });
            }

            const deletedName = index !== -1
                ? String(items[index].name || "").trim()
                : "";
            const deletedQuestionCount = index !== -1
                ? Number(items[index].questionCount || 0)
                : 0;

            if (index !== -1) {
                const fileName = items[index].fileName;
                const filePath = path.join(dir, fileName);

                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }

                items.splice(index, 1);
                writeMetadata(dir, items);
            }

            if (firebaseExists) {
                await deleteHTMLFromFirebase(id);
            }

            // Remove any old local duplicate of the same quiz too.
            const duplicateName = deletedName || firebaseDeletedName;
            const duplicateQuestionCount = deletedName
                ? deletedQuestionCount
                : firebaseDeletedQuestionCount;

            if (duplicateName) {
                const latest = readMetadata(dir);
                const duplicateItems = latest.filter(item =>
                    String(item.name || "").trim() === duplicateName &&
                    Number(item.questionCount || 0) === duplicateQuestionCount
                );

                for (const duplicate of duplicateItems) {
                    const duplicatePath = path.join(dir, duplicate.fileName);
                    if (fs.existsSync(duplicatePath)) {
                        fs.unlinkSync(duplicatePath);
                    }
                }

                if (duplicateItems.length) {
                    writeMetadata(
                        dir,
                        latest.filter(item =>
                            !duplicateItems.some(duplicate => duplicate.id === item.id)
                        )
                    );
                }
            }

            res.json({
                success: true,
                message: firebaseExists
                    ? "MCQ file local storage aur Firebase Firestore dono se delete ho gaya."
                    : "MCQ file delete ho gaya.",
                firebaseDeleted: firebaseExists
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);

/* ======================================================
   LEGACY JSON MCQ SAVE
====================================================== */

app.post(
    "/api/save-mcqs",
    async (req, res) => {
        try {
            const {
                classNumber,
                subject,
                chapterNumber,
                chapterTitle,
                questions
            } = req.body;

            if (
                !classNumber ||
                !subject ||
                !chapterNumber
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Class, subject aur chapter required hain."
                });
            }

            if (
                !Array.isArray(questions) ||
                !questions.length
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Questions array empty hai."
                });
            }

            const info =
                validateMCQLocation(
                    classNumber,
                    subject,
                    chapterNumber
                );

            const chapter =
                info.chapterNumber;

            const folder =
                subjectFolder(
                    info.subject
                );

            const data = {
                title:
                    chapterTitle ||
                    `Chapter ${chapter}`,

                chapterTitle:
                    chapterTitle ||
                    `Chapter ${chapter}`,

                class:
                    info.classNumber,

                subject: folder,

                chapter,

                totalQuestions:
                    questions.length,

                generatedAt:
                    new Date().toISOString(),

                questions
            };

            const dir =
                path.join(
                    DATA_DIR,
                    `class${info.classNumber}`,
                    "MCQ",
                    folder
                );

            fs.mkdirSync(
                dir,
                { recursive: true }
            );

            const fileName =
                `chapter-${String(chapter).padStart(2, "0")}.json`;

            const filePath =
                path.join(
                    dir,
                    fileName
                );

            if (
                fs.existsSync(filePath)
            ) {
                fs.copyFileSync(
                    filePath,
                    `${filePath}.backup-${Date.now()}`
                );
            }

            fs.writeFileSync(
                filePath,
                JSON.stringify(
                    data,
                    null,
                    2
                ),
                "utf8"
            );

            let firebaseSaved = false;

            if (firebaseEnabled) {
                firebaseSaved =
                    await saveQuizToFirestore(
                        info.classNumber,
                        info.subject,
                        info.chapterNumber,
                        data
                    );
            }

            res.json({
                success: true,
                message:
                    firebaseSaved
                        ? `${questions.length} MCQs Firebase Firestore mein permanently save ho gaye.`
                        : `${questions.length} MCQs local JSON mein save ho gaye. Firebase credentials available nahi hain.`,
                totalQuestions:
                    questions.length,
                fileName,
                firebaseSaved
            });
        } catch (error) {
            console.error(
                "MCQ save error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);

/* ======================================================
   SAVED JSON MCQ RENAME
====================================================== */

app.patch(
    "/api/mcqs/rename",
    requireOwner,
    async (req, res) => {
        try {
            const info = validateMCQLocation(
                req.body.classNumber,
                req.body.subject,
                req.body.chapterNumber
            );

            const newTitle =
                sanitizeFileBaseName(
                    req.body.newName
                );

            const dir = path.join(
                DATA_DIR,
                `class${info.classNumber}`,
                "MCQ",
                subjectFolder(info.subject)
            );

            const fileName =
                `chapter-${String(info.chapterNumber).padStart(2, "0")}.json`;

            const filePath =
                path.join(
                    dir,
                    fileName
                );

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Saved JSON MCQ nahi mila."
                });
            }

            const data =
                JSON.parse(
                    fs.readFileSync(
                        filePath,
                        "utf8"
                    )
                );

            data.title = newTitle;
            data.chapterTitle = newTitle;
            data.updatedAt =
                new Date().toISOString();

            const tempPath =
                `${filePath}.tmp`;

            fs.writeFileSync(
                tempPath,
                JSON.stringify(
                    data,
                    null,
                    2
                ),
                "utf8"
            );

            fs.renameSync(
                tempPath,
                filePath
            );

            let firebaseUpdated = false;

            if (firebaseEnabled) {
                const ref =
                    firestoreQuizRef(
                        info.classNumber,
                        info.subject,
                        info.chapterNumber
                    );

                await ref.set({
                    title: newTitle,
                    chapterTitle: newTitle,
                    updatedAt:
                        new Date().toISOString()
                }, {
                    merge: true
                });

                firebaseUpdated = true;
            }

            res.json({
                success: true,
                message:
                    firebaseUpdated
                        ? "JSON MCQ name Firebase mein bhi update ho gaya."
                        : "JSON MCQ name update ho gaya.",
                title: newTitle,
                firebaseUpdated
            });
        } catch (error) {
            console.error(
                "JSON rename error:",
                error
            );

            res.status(400).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);

/* ======================================================
   SAVED JSON MCQ DELETE
====================================================== */

app.post(
    "/api/mcqs/delete",
    requireOwner,
    async (req, res) => {
        try {
            const info = validateMCQLocation(
                req.body.classNumber,
                req.body.subject,
                req.body.chapterNumber
            );

            const dir = path.join(
                DATA_DIR,
                `class${info.classNumber}`,
                "MCQ",
                subjectFolder(info.subject)
            );

            const fileName =
                `chapter-${String(info.chapterNumber).padStart(2, "0")}.json`;

            const filePath =
                path.join(
                    dir,
                    fileName
                );

            const localExists =
                fs.existsSync(filePath);

            const ref =
                firestoreQuizRef(
                    info.classNumber,
                    info.subject,
                    info.chapterNumber
                );

            let firebaseExists = false;

            if (firebaseEnabled && ref) {
                const snapshot =
                    await ref.get();

                firebaseExists =
                    snapshot.exists;
            }

            if (!localExists && !firebaseExists) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Saved JSON MCQ nahi mila."
                });
            }

            if (localExists) {
                fs.unlinkSync(filePath);
            }

            if (firebaseEnabled && ref && firebaseExists) {
                await ref.delete();
            }

            res.json({
                success: true,
                message:
                    firebaseExists
                        ? "Saved JSON MCQ local storage aur Firebase dono se delete ho gaya."
                        : "Saved JSON MCQ delete ho gaya.",
                deletedFile: fileName,
                firebaseDeleted: firebaseExists
            });
        } catch (error) {
            console.error(
                "JSON delete error:",
                error
            );

            res.status(400).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);

/* ======================================================
   OLD JSON MCQ GET
====================================================== */

app.get(
    "/api/mcqs/:classNumber/:subject/:chapterNumber",

    async (req, res) => {
        try {
            const info =
                validateMCQLocation(
                    req.params.classNumber,
                    req.params.subject,
                    req.params.chapterNumber
                );

            if (firebaseEnabled) {
                const ref =
                    firestoreQuizRef(
                        info.classNumber,
                        info.subject,
                        info.chapterNumber
                    );

                const snapshot =
                    await ref.get();

                if (snapshot.exists) {
                    return res.json({
                        success: true,
                        exists: true,
                        source: "firebase",
                        data:
                            snapshot.data()
                    });
                }
            }

            const folder =
                subjectFolder(
                    info.subject
                );

            const filePath =
                path.join(
                    DATA_DIR,
                    `class${info.classNumber}`,
                    "MCQ",
                    folder,
                    `chapter-${String(info.chapterNumber).padStart(2, "0")}.json`
                );

            if (
                !fs.existsSync(filePath)
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        exists: false,
                        message:
                            "Saved MCQ nahi mila."
                    });
            }

            const data =
                JSON.parse(
                    fs.readFileSync(
                        filePath,
                        "utf8"
                    )
                );

            res.json({
                success: true,
                exists: true,
                source: "local",
                data
            });
        } catch (error) {
            console.error(
                "JSON get error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ======================================================
   CS FINAL HIERARCHY V2
   Course/Chapter -> Main Topic -> Subtopic -> MCQ
   Existing APIs remain untouched for backward compatibility.
====================================================== */

const CS_MAIN_TOPICS_FILE_V2 = path.join(DATA_DIR, "cs-main-topics.json");

function readCSMainTopicsV2(){
    if(!fs.existsSync(CS_MAIN_TOPICS_FILE_V2)) return [];
    try{
        const data=JSON.parse(fs.readFileSync(CS_MAIN_TOPICS_FILE_V2,"utf8"));
        return Array.isArray(data.items)?data.items:[];
    }catch{
        return [];
    }
}

function writeCSMainTopicsV2(items){
    fs.mkdirSync(DATA_DIR,{recursive:true});
    const temp=`${CS_MAIN_TOPICS_FILE_V2}.tmp`;
    fs.writeFileSync(temp,JSON.stringify({items},null,2),"utf8");
    fs.renameSync(temp,CS_MAIN_TOPICS_FILE_V2);
}

async function getFirebaseCSMainTopicsV2(){
    if(!firebaseEnabled||!db) return [];
    const snap=await db.collection("csMainTopics").get();
    return snap.docs.map(doc=>({...doc.data(),id:doc.id}));
}

async function saveFirebaseCSMainTopicV2(item){
    if(!firebaseEnabled||!db) return false;
    await db.collection("csMainTopics").doc(item.id).set(item,{merge:true});
    return true;
}

async function deleteFirebaseCSMainTopicV2(id){
    if(!firebaseEnabled||!db) return false;
    const ref=db.collection("csMainTopics").doc(String(id));
    const snap=await ref.get();
    if(!snap.exists) return false;
    await ref.delete();
    return true;
}

/* ---------- MAIN TOPICS ---------- */

app.get("/api/cs/main-topics/:subject/:chapterNumber",async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.params.subject);
        const chapterNumber=Number(req.params.chapterNumber);

        const local=readCSMainTopicsV2().filter(x=>
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber
        );

        let remote=[];
        if(firebaseEnabled&&db){
            try{
                remote=(await getFirebaseCSMainTopicsV2()).filter(x=>
                    String(x.subject).toLowerCase()===subject &&
                    Number(x.chapterNumber)===chapterNumber
                );
            }catch{}
        }

        const map=new Map();
        [...local,...remote].forEach(x=>x?.id&&map.set(String(x.id),x));

        const items=[...map.values()].sort((a,b)=>
            Number(a.order||0)-Number(b.order||0) ||
            String(a.title||"").localeCompare(String(b.title||""),undefined,{sensitivity:"base"})
        );

        res.json({success:true,items});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.post("/api/cs/main-topics",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const title=String(req.body.title||"").trim();

        if(!title) throw new Error("Main Topic Title daaliye.");

        const chapter=getCSChapter(subject,chapterNumber);
        if(!chapter) throw new Error("Pehle Course/Chapter select karein.");

        const items=readCSMainTopicsV2();

        const duplicate=items.find(x=>
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber &&
            String(x.title||"").trim().toLowerCase()===title.toLowerCase()
        );

        if(duplicate){
            return res.json({success:true,item:duplicate,migratedLegacySubtopics:0});
        }

        const siblings=items.filter(x=>
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber
        );

        const now=new Date().toISOString();
        const item={
            id:`cs-main-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`,
            subject,
            chapterNumber,
            title,
            order:siblings.length+1,
            createdAt:now,
            updatedAt:now,
            source:"admin"
        };

        items.push(item);
        writeCSMainTopicsV2(items);

        if(firebaseEnabled&&db){
            try{await saveFirebaseCSMainTopicV2(item);}catch{}
        }

        // Preserve the two existing flat DBMS subtopics by attaching them
        // only when the FIRST Main Topic is created for that Course/Chapter.
        let migrated=0;
        if(siblings.length===0){
            const subs=readCSSubtopics();
            for(const sub of subs){
                if(
                    String(sub.subject).toLowerCase()===subject &&
                    Number(sub.chapterNumber)===chapterNumber &&
                    !sub.mainTopicId
                ){
                    sub.mainTopicId=item.id;
                    sub.updatedAt=now;
                    migrated++;
                    if(firebaseEnabled&&db){
                        try{await saveFirebaseCSSubtopic(sub);}catch{}
                    }
                }
            }
            if(migrated) writeCSSubtopics(subs);
        }

        res.json({success:true,item,migratedLegacySubtopics:migrated});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.patch("/api/cs/main-topics/rename",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const id=String(req.body.id||"").trim();
        const newTitle=String(req.body.newTitle||"").trim();

        if(!id||!newTitle) throw new Error("Main Topic ID aur new title required hai.");

        const items=readCSMainTopicsV2();
        const index=items.findIndex(x=>
            String(x.id)===id &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber
        );

        if(index<0) return res.status(404).json({success:false,message:"Main Topic nahi mila."});

        const duplicate=items.some(x=>
            String(x.id)!==id &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber &&
            String(x.title||"").trim().toLowerCase()===newTitle.toLowerCase()
        );

        if(duplicate) return res.status(409).json({success:false,message:"Is naam ka Main Topic already hai."});

        items[index].title=newTitle;
        items[index].updatedAt=new Date().toISOString();
        writeCSMainTopicsV2(items);

        if(firebaseEnabled&&db){
            try{await saveFirebaseCSMainTopicV2(items[index]);}catch{}
        }

        res.json({success:true,item:items[index]});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.delete("/api/cs/main-topics",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const id=String(req.body.id||"").trim();

        const items=readCSMainTopicsV2();
        const found=items.find(x=>
            String(x.id)===id &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber
        );

        if(!found) return res.status(404).json({success:false,message:"Main Topic nahi mila."});

        writeCSMainTopicsV2(items.filter(x=>String(x.id)!==id));

        const subs=readCSSubtopics();
        const childSubs=subs.filter(x=>String(x.mainTopicId||"")===id);
        writeCSSubtopics(subs.filter(x=>String(x.mainTopicId||"")!==id));

        if(firebaseEnabled&&db){
            try{await deleteFirebaseCSMainTopicV2(id);}catch{}
            for(const child of childSubs){
                try{await deleteFirebaseCSSubtopic(child.id);}catch{}
            }
        }

        res.json({
            success:true,
            message:"Main Topic delete ho gaya. Existing MCQ files delete nahi hue."
        });
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

/* ---------- SUBTOPICS ---------- */

app.get("/api/cs/subtopics-v2/:subject/:chapterNumber",async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.params.subject);
        const chapterNumber=Number(req.params.chapterNumber);
        const mainTopicId=String(req.query.mainTopicId||"").trim();

        if(!mainTopicId) throw new Error("Main Topic select karein.");

        const mainTopic=readCSMainTopicsV2().find(x=>
            String(x.id)===mainTopicId &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber
        );

        if(!mainTopic) return res.status(404).json({success:false,message:"Main Topic nahi mila."});

        const local=readCSSubtopics().filter(x=>
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber &&
            String(x.mainTopicId||"")===mainTopicId
        );

        let remote=[];
        if(firebaseEnabled&&db){
            try{
                remote=(await getFirebaseCSSubtopics()).filter(x=>
                    String(x.subject).toLowerCase()===subject &&
                    Number(x.chapterNumber)===chapterNumber &&
                    String(x.mainTopicId||"")===mainTopicId
                );
            }catch{}
        }

        const map=new Map();
        [...local,...remote].forEach(x=>x?.id&&map.set(String(x.id),x));

        res.json({
            success:true,
            mainTopic,
            items:[...map.values()].sort((a,b)=>
                String(a.title||"").localeCompare(String(b.title||""),undefined,{sensitivity:"base"})
            )
        });
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.post("/api/cs/subtopics-v2",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const mainTopicId=String(req.body.mainTopicId||"").trim();
        const title=String(req.body.title||"").trim();

        if(!mainTopicId) throw new Error("Pehle Main Topic select karein.");
        if(!title) throw new Error("Subtopic Title daaliye.");

        const mainTopic=readCSMainTopicsV2().find(x=>
            String(x.id)===mainTopicId &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber
        );

        if(!mainTopic) throw new Error("Selected Main Topic valid nahi hai.");

        const items=readCSSubtopics();

        const duplicate=items.find(x=>
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber &&
            String(x.mainTopicId||"")===mainTopicId &&
            String(x.title||"").trim().toLowerCase()===title.toLowerCase()
        );

        if(duplicate) return res.json({success:true,item:duplicate});

        const now=new Date().toISOString();
        const item={
            id:`cs-sub-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`,
            subject,
            chapterNumber,
            mainTopicId,
            title,
            createdAt:now,
            updatedAt:now,
            source:"admin"
        };

        items.push(item);
        writeCSSubtopics(items);

        if(firebaseEnabled&&db){
            try{await saveFirebaseCSSubtopic(item);}catch{}
        }

        res.json({success:true,item});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.patch("/api/cs/subtopics-v2/rename",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const mainTopicId=String(req.body.mainTopicId||"").trim();
        const id=String(req.body.id||"").trim();
        const newTitle=String(req.body.newTitle||"").trim();

        const items=readCSSubtopics();
        const index=items.findIndex(x=>
            String(x.id)===id &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber &&
            String(x.mainTopicId||"")===mainTopicId
        );

        if(index<0) return res.status(404).json({success:false,message:"Subtopic nahi mila."});

        const duplicate=items.some(x=>
            String(x.id)!==id &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber &&
            String(x.mainTopicId||"")===mainTopicId &&
            String(x.title||"").trim().toLowerCase()===newTitle.toLowerCase()
        );

        if(duplicate) return res.status(409).json({success:false,message:"Is naam ka Subtopic already hai."});

        items[index].title=newTitle;
        items[index].updatedAt=new Date().toISOString();
        writeCSSubtopics(items);

        if(firebaseEnabled&&db){
            try{await saveFirebaseCSSubtopic(items[index]);}catch{}
        }

        res.json({success:true,item:items[index]});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

app.delete("/api/cs/subtopics-v2",requireOwner,async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const mainTopicId=String(req.body.mainTopicId||"").trim();
        const id=String(req.body.id||"").trim();

        const items=readCSSubtopics();
        const found=items.find(x=>
            String(x.id)===id &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber &&
            String(x.mainTopicId||"")===mainTopicId
        );

        if(!found) return res.status(404).json({success:false,message:"Subtopic nahi mila."});

        writeCSSubtopics(items.filter(x=>String(x.id)!==id));

        if(firebaseEnabled&&db){
            try{await deleteFirebaseCSSubtopic(id);}catch{}
        }

        res.json({success:true,message:"Subtopic delete ho gaya. Existing MCQ files delete nahi hue."});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

/* ---------- HIERARCHY ---------- */

app.get("/api/cs/hierarchy-v2/:subject/:chapterNumber",async(req,res)=>{
    try{
        const subject=normalizeCSSubject(req.params.subject);
        const chapterNumber=Number(req.params.chapterNumber);

        const mains=readCSMainTopicsV2().filter(x=>
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber
        );

        const subs=readCSSubtopics().filter(x=>
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber
        );

        const items=mains
            .sort((a,b)=>Number(a.order||0)-Number(b.order||0))
            .map(main=>({
                ...main,
                subtopics:subs.filter(x=>String(x.mainTopicId||"")===String(main.id))
            }));

        res.json({success:true,items});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});


/* ------------------------------------------------------
   PUBLIC FINAL HIERARCHY
   Subject -> Main Topic -> Subtopic -> MCQ Sets
------------------------------------------------------ */
app.get("/api/cs/public-hierarchy-v2/:subject", async (req,res)=>{
    try{
        const subject=normalizeCSSubject(req.params.subject);

        let mains=readCSMainTopicsV2().filter(x=>
            String(x.subject).toLowerCase()===subject
        );
        if(firebaseEnabled&&db){
            try{
                const remote=await getFirebaseCSMainTopicsV2();
                const map=new Map(mains.map(x=>[String(x.id),x]));
                remote.filter(x=>String(x.subject).toLowerCase()===subject)
                    .forEach(x=>map.set(String(x.id),x));
                mains=[...map.values()];
            }catch{}
        }

        let subs=readCSSubtopics().filter(x=>
            String(x.subject).toLowerCase()===subject
        );
        if(firebaseEnabled&&db){
            try{
                const remote=await getFirebaseCSSubtopics();
                const map=new Map(subs.map(x=>[String(x.id),x]));
                remote.filter(x=>String(x.subject).toLowerCase()===subject)
                    .forEach(x=>map.set(String(x.id),x));
                subs=[...map.values()];
            }catch{}
        }

        const chapterNumbers=[...new Set(mains.map(x=>Number(x.chapterNumber)).filter(Number.isFinite))];
        const mcqByChapter=new Map();
        for(const chapterNumber of chapterNumbers){
            let items=[];
            try{ items=readCSMCQMetadata(subject,chapterNumber); }catch{}
            if(firebaseEnabled&&db){
                try{
                    const remote=await listHTMLFromFirestore(0,subject,chapterNumber);
                    const map=new Map(items.map(x=>[String(x.id),x]));
                    remote.forEach(x=>map.set(String(x.id),x));
                    items=[...map.values()];
                }catch{}
            }
            mcqByChapter.set(chapterNumber,items.map(x=>({
                ...x,
                url:`/api/cs/mcq-html/file/${encodeURIComponent(x.id)}`
            })));
        }

        mains.sort((a,b)=>Number(a.order||0)-Number(b.order||0) || String(a.title||'').localeCompare(String(b.title||''),undefined,{sensitivity:'base'}));

        const items=mains.map(main=>{
            const chapterNumber=Number(main.chapterNumber);
            const chapterMcqs=mcqByChapter.get(chapterNumber)||[];
            const children=subs.filter(s=>String(s.mainTopicId||'')===String(main.id))
                .sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),undefined,{sensitivity:'base'}))
                .map(sub=>({
                    ...sub,
                    mcqSets:chapterMcqs.filter(item=>String(item.subtopicId||'')===String(sub.id))
                }));
            return {...main,subtopics:children};
        });

        res.json({success:true,subject,items});
    }catch(error){
        res.status(400).json({success:false,message:error.message});
    }
});

/* ---------- MCQ HTML UPLOAD FOR SELECTED SUBTOPIC ---------- */

app.post("/api/cs/mcq-html/upload-v2",requireOwner,mcqHTMLUpload.single("mcqFile"),async(req,res)=>{
    try{
        if(!req.file) return res.status(400).json({success:false,message:"MCQ HTML file select karo."});

        const subject=normalizeCSSubject(req.body.subject);
        const chapterNumber=Number(req.body.chapterNumber);
        const mainTopicId=String(req.body.mainTopicId||"").trim();
        const subtopicId=String(req.body.subtopicId||"").trim();

        if(!mainTopicId) throw new Error("Main Topic select karein.");
        if(!subtopicId) throw new Error("Subtopic select karein.");

        const mainTopic=readCSMainTopicsV2().find(x=>
            String(x.id)===mainTopicId &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber
        );
        if(!mainTopic) throw new Error("Selected Main Topic valid nahi hai.");

        const subtopic=readCSSubtopics().find(x=>
            String(x.id)===subtopicId &&
            String(x.subject).toLowerCase()===subject &&
            Number(x.chapterNumber)===chapterNumber &&
            String(x.mainTopicId||"")===mainTopicId
        );
        if(!subtopic) throw new Error("Selected Subtopic valid nahi hai.");

        const html=req.file.buffer.toString("utf8");
        if(!html.trim()) throw new Error("HTML file empty hai.");

        const questionCount=questionCountFromHTML(html);
        const title=htmlTitle(html)||path.basename(req.file.originalname,path.extname(req.file.originalname));
        const id=`cs-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
        const fileName=`mcq-${id}.html`;
        const now=new Date().toISOString();

        const item={
            id,
            fileName,
            originalName:req.file.originalname,
            name:title,
            questionCount,
            mainTopicId,
            subtopicId,
            createdAt:now,
            updatedAt:now,
            url:`/api/cs/mcq-html/file/${encodeURIComponent(id)}`
        };

        const dir=csChapterDir(subject,chapterNumber);
        fs.mkdirSync(dir,{recursive:true});
        fs.writeFileSync(path.join(dir,fileName),html,"utf8");

        const items=readCSMCQMetadata(subject,chapterNumber);
        items.push(item);
        writeCSMCQMetadata(subject,chapterNumber,items);

        if(firebaseEnabled&&db){
            try{
                await saveHTMLToFirebase(
                    {classNumber:0,subject,chapterNumber,mainTopicId,subtopicId},
                    item,
                    html
                );
            }catch(error){
                console.warn("CS Firestore MCQ save failed; local copy kept:",error.message);
            }
        }

        res.json({success:true,item});
    }catch(error){
        console.error("CS hierarchy MCQ upload error:",error);
        res.status(400).json({success:false,message:error.message||"MCQ upload failed."});
    }
});


/* ======================================================
   STATIC WEBSITE
====================================================== */

app.use(
    express.static(
        ROOT_DIR
    )
);

app.get(
    "/",
    (req, res) => {
        res.sendFile(
            path.join(
                ROOT_DIR,
                "index.html"
            )
        );
    }
);

/* ======================================================
   API 404
====================================================== */

app.use(
    "/api",
    (req, res) => {
        res.status(404).json({
            success: false,
            message:
                "API endpoint nahi mila."
        });
    }
);

/* ======================================================
   ERROR HANDLER
====================================================== */

app.use(
    (error, req, res, next) => {
        console.error(
            "Server Error:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            success: false,
            message:
                error.message ||
                "Internal server error."
        });
    }
);

/* ======================================================
   START
====================================================== */

app.listen(
    PORT,
    () => {
        console.log("");
        console.log(
            "=============================================="
        );
        console.log(
            " NCERT GK-GS NOTES + MCQ SERVER"
        );
        console.log(
            "=============================================="
        );
        console.log(
            `Server listening on port ${PORT}`
        );
        console.log(
            `Data:   ${DATA_DIR}`
        );
        console.log(
            "MCQ:    HTML Upload + Multiple Files + Permanent Storage"
        );
        console.log(
            "AI:     Disabled (Ollama removed)"
        );
        console.log(
            "Admin:  Owner-only upload / rename / delete"
        );
        console.log(
            "=============================================="
        );
        console.log("");
    }
);
