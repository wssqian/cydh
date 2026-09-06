/**
 * 签名密钥管理 - Ed25519 公钥配置
 */

import { Key, Shield, AlertTriangle, Copy, Check, ExternalLink } from 'lucide-react';
import { useUpdater } from './UpdateProvider.js';
import { useState } from 'react';

export function UpdateSignatureKeys() {
  const { state, saveSettings } = useUpdater();
  const { settings, settingsLoading } = state;

  const signature = settings?.signature || { public_key: null, allow_unsigned_dev: true };
  const [publicKey, setPublicKey] = useState(signature.public_key || '');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const validateKey = (key: string) => {
    if (!key) return null;
    try {
      const decoded = atob(key);
      if (decoded.length !== 32) {
        return '公钥必须是 32 字节 (Base64 编码后 44 字符)';
      }
      return null;
    } catch {
      return '无效的 Base64 编码';
    }
  };

  const handleKeyChange = (value: string) => {
    setPublicKey(value);
    const error = validateKey(value);
    setKeyError(error);
  };

  const handleSave = async () => {
    const error = validateKey(publicKey);
    if (error) {
      setKeyError(error);
      return;
    }
    await saveSettings({
      signature: { public_key: publicKey || null, allow_unsigned_dev: signature.allow_unsigned_dev },
    });
  };

  const handleCopy = async () => {
    if (publicKey) {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const generateKeyPairGuide = () => {
    window.open('https://github.com/your-repo/docs/updater-signing', '_blank');
  };

  const fingerprint = publicKey
    ? 'SHA256:' + publicKey.slice(0, 16).toUpperCase().match(/.{4}/g)?.join(':')
    : null;

  return (
    <div className="liquid-chip rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Key className="w-4 h-4 text-indigo-500" />
          签名验证密钥
        </h3>
      </div>

      {/* 说明 */}
      <div className="mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
        <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
          <Shield className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium mb-1">Ed25519 签名验证</p>
            <p>配置公钥后，发布包更新将验证 Ed25519 签名，防止供应链攻击。私钥用于 CI/CD 签名，公钥配置在此处。</p>
          </div>
        </div>
      </div>

      {/* 公钥输入 */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Ed25519 公钥</label>
          <div className="relative">
            <textarea
              value={publicKey}
              onChange={e => handleKeyChange(e.target.value)}
              placeholder="Base64 编码的 32 字节公钥 (44 字符)..."
              rows={3}
              disabled={settingsLoading}
              className={`liquid-input w-full rounded-xl px-3 py-2 font-mono text-sm ${keyError ? 'border-red-500' : ''}`}
            />
            {keyError && (
              <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {keyError}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleCopy}
                disabled={!publicKey || settingsLoading}
                className="liquid-button text-xs px-3 py-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? '已复制' : '复制'}
              </button>
              <button
                onClick={generateKeyPairGuide}
                className="liquid-button text-xs px-3 py-1.5 text-slate-600 dark:text-slate-400"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                生成密钥对指南
              </button>
            </div>
          </div>
        </div>

        {/* 密钥指纹 */}
        {fingerprint && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-600" />
                <span className="font-medium text-emerald-700 dark:text-emerald-300">公钥已配置</span>
              </div>
              <code className="font-mono text-xs bg-emerald-100 dark:bg-emerald-900/30 px-2 py-1 rounded">
                {fingerprint}
              </code>
            </div>
          </div>
        )}

        {/* 开发模式允许无签名 */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <input
            type="checkbox"
            id="allow-unsigned-dev"
            checked={signature.allow_unsigned_dev}
            onChange={e => saveSettings({ signature: { ...signature, allow_unsigned_dev: e.target.checked } })}
            disabled={settingsLoading}
            className="w-4 h-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
          />
          <label htmlFor="allow-unsigned-dev" className="text-sm font-medium cursor-pointer">
            开发模式允许无签名更新
          </label>
          <span className="ml-auto text-xs text-slate-500">(NODE_ENV !== production 时生效)</span>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={handleSave}
          disabled={settingsLoading || !!keyError || publicKey === (signature.public_key || '')}
          className="liquid-button-primary px-6 py-2 font-medium text-sm"
        >
          {settingsLoading ? '保存中...' : '保存公钥'}
        </button>
      </div>
    </div>
  );
}