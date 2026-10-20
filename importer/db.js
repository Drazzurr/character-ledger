/* Importer storage (IndexedDB "ledger-importer"). Works in the page and in the worker.
   books: one record per PDF (id = pdf.js fingerprint + page count)
   pages: Stage 1 output per page, key [book, page]
   files: the PDF itself, so an import can resume or re-run without choosing the file again
   layout: Stage 2 and 3 output per page (blocks in reading order with roles), key [book, page] */

const DB_NAME = "ledger-importer";
const DB_VERSION = 2;
let dbP = null;

export function openDb() {
  if (!dbP) {
    dbP = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
        if (!db.objectStoreNames.contains("pages")) db.createObjectStore("pages", { keyPath: ["book", "page"] });
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
        if (!db.objectStoreNames.contains("layout")) db.createObjectStore("layout", { keyPath: ["book", "page"] });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("Could not open importer storage"));
      r.onblocked = () => rej(new Error("Importer storage is blocked by another tab"));
    }).catch((e) => { dbP = null; throw e; });
  }
  return dbP;
}

async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    const q = fn(t);
    if (q && "onsuccess" in q) q.onsuccess = () => { out = q.result; };
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error || new Error("Importer storage error"));
  });
}

export const getBook = (id) => tx("books", "readonly", (t) => t.objectStore("books").get(id));
export const putBook = (b) => tx("books", "readwrite", (t) => t.objectStore("books").put(b));
export const listBooks = () => tx("books", "readonly", (t) => t.objectStore("books").getAll());
export const getPage = (book, page) => tx("pages", "readonly", (t) => t.objectStore("pages").get([book, page]));
export const putPage = (p) => tx("pages", "readwrite", (t) => t.objectStore("pages").put(p));
export const getFile = (book) => tx("files", "readonly", (t) => t.objectStore("files").get(book));
export const putFile = (book, blob) => tx("files", "readwrite", (t) => t.objectStore("files").put(blob, book));

export function getPages(book, from = 1, to = 1e6) {
  const range = IDBKeyRange.bound([book, from], [book, to]);
  return tx("pages", "readonly", (t) => t.objectStore("pages").getAll(range));
}

export async function pageKeys(book) {
  const range = IDBKeyRange.bound([book, 0], [book, 1e9]);
  const keys = await tx("pages", "readonly", (t) => t.objectStore("pages").getAllKeys(range));
  return (keys || []).map((k) => k[1]);
}

export const getLayout = (book, page) => tx("layout", "readonly", (t) => t.objectStore("layout").get([book, page]));
export function getLayouts(book, from = 1, to = 1e6) {
  const range = IDBKeyRange.bound([book, from], [book, to]);
  return tx("layout", "readonly", (t) => t.objectStore("layout").getAll(range));
}
/** Saves many page layouts in one transaction. */
export function putLayouts(list) {
  return tx("layout", "readwrite", (t) => { const st = t.objectStore("layout"); for (const L of list) st.put(L); return null; });
}

export async function deleteBook(book) {
  const range = IDBKeyRange.bound([book, 0], [book, 1e9]);
  await tx(["books", "pages", "files", "layout"], "readwrite", (t) => {
    t.objectStore("pages").delete(range);
    t.objectStore("layout").delete(range);
    t.objectStore("files").delete(book);
    t.objectStore("books").delete(book);
  });
}

export async function deleteFile(book) {
  await tx("files", "readwrite", (t) => t.objectStore("files").delete(book));
}
