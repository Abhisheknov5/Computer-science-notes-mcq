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
            `${OWNER_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_TIME / 1000}; HttpOnly; SameSite=Lax; Path=/`
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

            res.json({
                success: true,
                items: Array.from(merged.values())
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

            if (firebaseEnabled) {
                const ref = firestoreHTMLRef(id);
                if (ref) {
                    const snapshot = await ref.get();
                    firebaseExists = snapshot.exists;
                }
            }

            if (index === -1 && !firebaseExists) {
                return res.status(404).json({
                    success: false,
                    message: "MCQ file nahi mila."
                });
            }

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
