import fs from "node:fs/promises";
import path from "node:path";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document } from "@langchain/core/documents";

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".pdf"]);
const MAX_DEPTH = 5;
const MAX_FILES = 300;

// Local embeddings — no API key, no per-call cost. The model is downloaded
// once (cached by @xenova/transformers) and reused for every folder we index.
const embeddings = new HuggingFaceTransformersEmbeddings({
  model: "Xenova/all-MiniLM-L6-v2",
});

// Module-level state: only one folder is "the indexed notes" at a time,
// matching the doc's "index <folder>" -> "ask about it" flow. Indexing a
// new folder simply replaces this.
let currentStore = null;
let currentFolder = null;

async function collectFiles(rootPath, depth = 0, results = []) {
  if (depth > MAX_DEPTH || results.length >= MAX_FILES) return results;

  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (results.length >= MAX_FILES) break;
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, depth + 1, results);
    } else if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

async function loadDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const loader = new PDFLoader(filePath);
    const docs = await loader.load();
    for (const doc of docs) doc.metadata.source = path.basename(filePath);
    return docs;
  }

  const content = await fs.readFile(filePath, "utf-8");
  return [new Document({ pageContent: content, metadata: { source: path.basename(filePath) } })];
}

// Loads every .txt/.md/.pdf file under folderPath into a fresh in-memory
// vector store, replacing whatever was indexed before.
export async function indexFolder(folderPath) {
  const files = await collectFiles(folderPath);
  if (files.length === 0) {
    throw new Error(`No .txt/.md/.pdf files found under "${folderPath}".`);
  }

  const rawDocs = [];
  for (const file of files) {
    rawDocs.push(...(await loadDocument(file)));
  }

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
  const chunks = await splitter.splitDocuments(rawDocs);

  currentStore = await MemoryVectorStore.fromDocuments(chunks, embeddings);
  currentFolder = folderPath;

  return { folder: folderPath, fileCount: files.length, chunkCount: chunks.length };
}

export function getIndexedFolder() {
  return currentFolder;
}

// Returns the top matching chunks for a query, each as { content, source, score }.
export async function queryNotes(query, topK = 4) {
  if (!currentStore) {
    throw new Error("No folder has been indexed yet. Ask me to index a folder first.");
  }
  const results = await currentStore.similaritySearchWithScore(query, topK);
  return results.map(([doc, score]) => ({
    content: doc.pageContent,
    source: doc.metadata.source,
    score,
  }));
}
