import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const file1 = '/Users/jinxiansheng/Downloads/信义认证系统-v5.0-ai综合版 (1)/临时资料文件夹/三体系6-12月客户名单00.xlsx';
const file2 = '/Users/jinxiansheng/Downloads/信义认证系统-v5.0-ai综合版 (1)/临时资料文件夹/快启获客-按企业保存20251010.xlsx';

function analyzeFile(filePath) {
    console.log(`Analyzing: ${path.basename(filePath)}`);
    const buf = fs.readFileSync(filePath);
    const wb = XLSX.read(buf, {type:'buffer'});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, {header: 1});
    if (json.length > 0) {
        console.log('Headers:', json[0]);
        console.log('Row 1:', json[1]);
    } else {
        console.log('Empty file');
    }
    console.log('---');
}

analyzeFile(file1);
analyzeFile(file2);
