import type { KnowledgeDoc } from '../../types';

const normalizeText = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\u4e00-\u9fa5]/g, '');

const normalizeTitle = (value: unknown) => normalizeText(value);

const normalizeFormat = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeSize = (value: unknown) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const normalizeContent = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return normalizeText(raw.slice(0, 2000));
};

const hashBytes = (bytes: Uint8Array) => {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const hashText = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return hashBytes(bytes);
};

export const buildKnowledgeDedupeHash = async (file: File, title?: string): Promise<string> => {
  const sampleSize = Math.min(file.size, 96 * 1024);
  const headBuf = await file.slice(0, sampleSize).arrayBuffer();
  const headHash = hashBytes(new Uint8Array(headBuf));
  const meta = [
    normalizeTitle(title || file.name),
    normalizeFormat(file.type),
    String(file.size || 0),
    String(file.lastModified || 0),
    headHash
  ].join('|');
  return `kh_${hashText(meta)}`;
};

const buildFallbackKey = (doc: Partial<KnowledgeDoc>) => {
  return [
    normalizeTitle(doc.title),
    normalizeFormat(doc.format),
    normalizeSize(doc.size)
  ].join('|');
};

export const findDuplicateKnowledgeDoc = (
  docs: KnowledgeDoc[],
  candidate: Partial<KnowledgeDoc> & { dedupeHash?: string }
): KnowledgeDoc | null => {
  if (!Array.isArray(docs) || !candidate) return null;

  const candidateHash = String(candidate.dedupeHash || '').trim();
  if (candidateHash) {
    const byHash = docs.find((doc) => String(doc.dedupeHash || '').trim() === candidateHash);
    if (byHash) return byHash;
  }

  const candidateFallbackKey = buildFallbackKey(candidate);
  if (candidateFallbackKey !== '||') {
    const byMeta = docs.find((doc) => buildFallbackKey(doc) === candidateFallbackKey);
    if (byMeta) return byMeta;
  }

  const candidateTitle = normalizeTitle(candidate.title);
  const candidateContent = normalizeContent(candidate.content);
  if (candidateTitle && candidateContent.length >= 80) {
    const byContent = docs.find((doc) => {
      const docTitle = normalizeTitle(doc.title);
      const docContent = normalizeContent(doc.content);
      return docTitle === candidateTitle && docContent.length >= 80 && docContent === candidateContent;
    });
    if (byContent) return byContent;
  }

  return null;
};

