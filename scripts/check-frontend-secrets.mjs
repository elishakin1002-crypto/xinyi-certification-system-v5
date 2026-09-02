import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist');
const forbiddenPatterns = [
  /\bKIMI_API_KEY\b/,
  /\bGEMINI_API_KEY\b/,
  /\bprocess\.env\.API_KEY\b/,
  /\bprocess\.env\.KIMI_API_KEY\b/,
  /\bAuthorization\s*:\s*[`'"]Bearer\b/
];

const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(fullPath));
    } else {
      out.push(fullPath);
    }
  }
  return out;
};

if (!fs.existsSync(distDir)) {
  console.error('[frontend-secrets] dist/ not found. Run npm run build first.');
  process.exit(1);
}

const textFiles = walk(distDir).filter((file) => /\.(html|js|css|map|txt)$/i.test(file));
const findings = [];

for (const file of textFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      findings.push(`${path.relative(process.cwd(), file)} matches ${pattern}`);
    }
  }
}

if (findings.length > 0) {
  console.error('[frontend-secrets] forbidden frontend secret markers found:');
  findings.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`[frontend-secrets] ok: scanned ${textFiles.length} dist files`);
