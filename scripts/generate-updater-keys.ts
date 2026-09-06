/**
 * 生成更新系统 Ed25519 签名密钥对
 *
 * 用法：
 *   npm run updater:gen-keys        # 输出公钥与私钥
 *   npm run updater:gen-keys -- --json   # 输出 JSON 格式（便于脚本解析）
 *
 * 公钥需配置到生产环境的 update 系统签名设置中；私钥仅保存在 CI/CD 加密 Secret。
 */

import nacl from 'tweetnacl';

function main() {
  const pair = nacl.sign.keyPair();
  const publicKey = Buffer.from(pair.publicKey).toString('base64');
  const secretKey = Buffer.from(pair.secretKey).toString('base64');

  const asJson = process.argv.includes('--json');

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          public_key: publicKey,
          secret_key: secretKey,
          algorithm: 'ed25519',
          note: 'secret_key 仅用于 CI/CD 签名，勿提交到源码仓库',
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('算法: Ed25519');
  console.log('');
  console.log('公钥（配置到管理面板「发布包签名验证」）:');
  console.log(`  PUBLIC_KEY=${publicKey}`);
  console.log('');
  console.log('私钥（配置到 CI/CD 加密 Secret，如 UPDATER_SIGNING_SECRET_KEY）:');
  console.log(`  SECRET_KEY=${secretKey}`);
  console.log('');
  console.log('安全提示:');
  console.log('  - 私钥绝不写入源码仓库或提交到 git。');
  console.log('  - 公钥可安全提交，用于生产验证。');
  console.log('  - 密钥泄露后应重新生成并轮换。');
}

main();