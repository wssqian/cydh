/**
 * 对 dist 归档进行 Ed25519 签名并计算 SHA256
 *
 * 用法：
 *   npm run updater:sign -- dist.tar.gz
 *
 * 需要在环境变量中提供 UPDATER_SIGNING_SECRET_KEY（Base64 私钥）。
 * 输出与归档同名的 .sig 文件（Base64 签名）和 .sha256 文件。
 */

import nacl from 'tweetnacl';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('用法: tsx scripts/sign-updater-dist.ts <dist.tar.gz | dist.zip>');
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    process.exit(1);
  }

  const secretKeyBase64 = process.env.UPDATER_SIGNING_SECRET_KEY;
  if (!secretKeyBase64) {
    console.error('缺少 UPDATER_SIGNING_SECRET_KEY 环境变量');
    process.exit(1);
  }

  const data = readFileSync(filePath);

  // SHA256
  const sha256 = createHash('sha256').update(data).digest('hex');
  writeFileSync(`${filePath}.sha256`, sha256);

  // Ed25519 签名
  const secretKey = Uint8Array.from(Buffer.from(secretKeyBase64, 'base64'));
  if (secretKey.length !== 64) {
    console.error('UPDATER_SIGNING_SECRET_KEY 应为 64 字节的 Base64 私钥');
    process.exit(1);
  }
  const signature = nacl.sign.detached(data, secretKey);
  writeFileSync(`${filePath}.sig`, Buffer.from(signature).toString('base64'));

  console.log(`已签名: ${filePath}`);
  console.log(`  SHA256: ${sha256}`);
  console.log(`  签名:   ${filePath}.sig`);
  console.log(`  摘要:   ${filePath}.sha256`);
}

main();