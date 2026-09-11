const fs=require('fs');
const {Client}=require('/opt/xinyi/node_modules/pg');
const {execFileSync}=require('child_process');
const {randomBytes}=require('crypto');
require('/opt/xinyi/node_modules/dotenv').config({path:'/opt/xinyi/.env.local'});
const dir='/opt/xinyi/backups/xinyi-20260910-104954';
const db='xinyi_verify_'+randomBytes(6).toString('hex');
(async()=>{
let created=false;let client;
try {
execFileSync('sudo',['-u','postgres','createdb','-O','xinyi',db]);created=true;
const url=new URL(process.env.DATABASE_URL||process.env.XINYI_DB_URL);url.pathname='/'+db;
execFileSync('pg_restore',['--exit-on-error','--no-owner','--no-acl','--dbname',url.toString(),dir+'/database.dump'],{stdio:'pipe'});
client=new Client({connectionString:url.toString()});await client.connect();
const {collectFingerprint}=await import('/opt/xinyi/scripts/lib/backupCommon.mjs');
const {compareFingerprint}=await import('/opt/xinyi/scripts/restore.mjs');
const manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json','utf8'));
const differences=compareFingerprint(manifest.tables,await collectFingerprint(client));
if(differences.length) throw new Error('Original-environment fingerprint mismatch: '+JSON.stringify(differences));
await client.query("SET TIME ZONE 'UTC'");
const tables={};
for(const name of Object.keys(manifest.tables)){
const ident='public."'+name.replaceAll('"','""')+'"';
const r=await client.query(`select count(*)::int as n, coalesce(md5(string_agg(t::text, '|' order by t::text COLLATE "C")), 'empty') as checksum from ${ident} t`);
tables[name]={rows:r.rows[0].n,checksum:r.rows[0].checksum};
}
fs.writeFileSync(dir+'/canonical-fingerprint.json',JSON.stringify({timezone:'UTC',collation:'C',tables},null,2),{mode:0o600});
console.log('Original backup restored and all 23 table fingerprints match; canonical UTC/C fingerprints saved.');
}finally{if(client)await client.end();if(created)execFileSync('sudo',['-u','postgres','dropdb',db]);}
})().catch(e=>{console.error(e.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[redacted]'));process.exitCode=1;});
