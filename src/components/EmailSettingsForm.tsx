import { useState, useEffect, type FormEvent } from "react";
import {
  Mail,
  Save,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
  Bell,
  Key,
  ExternalLink,
} from "lucide-react";

interface EmailSettingsFormProps {
  onSaved?: () => void;
}

interface EmailSettings {
  resend_api_key: string;
  from_addr: string;
  from_name: string;
  notify_on_submission: boolean;
  notify_on_error: boolean;
  admin_recipients: string;
}

const defaultSettings: EmailSettings = {
  resend_api_key: "",
  from_addr: "",
  from_name: "次元导航",
  notify_on_submission: true,
  notify_on_error: false,
  admin_recipients: "",
};

export default function EmailSettingsForm({ onSaved }: EmailSettingsFormProps) {
  const [settings, setSettings] = useState<EmailSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [originalKey, setOriginalKey] = useState(""); // 跟踪原始(掩盖后)的API Key

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/email/settings");
      if (!response.ok) throw new Error("读取设置失败");
      const data = await response.json() as { settings: EmailSettings };
      setSettings({
        ...data.settings,
        admin_recipients: Array.isArray(data.settings.admin_recipients)
          ? data.settings.admin_recipients.join(", ")
          : data.settings.admin_recipients || "",
      });
      setOriginalKey(data.settings.resend_api_key || "");
    } catch {
      setError("无法加载邮箱设置");
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = <K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload: Record<string, any> = {
        from_addr: settings.from_addr,
        from_name: settings.from_name,
        notify_on_submission: settings.notify_on_submission,
        notify_on_error: settings.notify_on_error,
        admin_recipients: settings.admin_recipients.split(",").map(s => s.trim()).filter(Boolean),
      };
      // 仅当 API Key 被用户修改过（与掩盖后的值不同）时才发送
      if (settings.resend_api_key !== originalKey) {
        payload.resend_api_key = settings.resend_api_key;
      }

      const response = await fetch("/api/admin/email/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "保存失败" }));
        throw new Error(data.error || "保存失败");
      }
      setSuccess("邮箱设置已保存");
      // 更新 originalKey 为新的掩盖值
      const savedData = await response.json() as { settings: EmailSettings };
      if (savedData.settings?.resend_api_key) {
        setOriginalKey(savedData.settings.resend_api_key);
        setSettings(prev => ({ ...prev, resend_api_key: savedData.settings.resend_api_key }));
      }
      onSaved?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!settings.admin_recipients) {
      setTestResult({ success: false, message: "请先填写管理员接收邮箱" });
      return;
    }
    if (!settings.resend_api_key) {
      setTestResult({ success: false, message: "请先填写 Resend API Key" });
      return;
    }
    if (!settings.from_addr) {
      setTestResult({ success: false, message: "请先填写发件人地址" });
      return;
    }

    setTestLoading(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: settings.admin_recipients.split(",")[0].trim(),
          // 传递当前表单中的配置，避免因未保存导致测试失败
          resend_api_key: settings.resend_api_key,
          from_addr: settings.from_addr,
          from_name: settings.from_name,
        }),
      });
      const data = await response.json();
      setTestResult({
        success: data.success,
        message: data.message || (data.success ? "测试邮件发送成功" : "发送失败"),
      });
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTestLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className="flex items-center gap-2 mb-2">
        <Mail className="w-5 h-5 text-pink-500" />
        <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
          Resend 邮箱配置
        </h3>
        <a
          href="https://resend.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-pink-500 hover:text-pink-600 inline-flex items-center gap-1 ml-1"
        >
          <ExternalLink className="w-3 h-3" />
          注册 Resend
        </a>
      </div>

      <div className="liquid-chip rounded-2xl p-4 text-xs text-slate-500 leading-relaxed space-y-1">
        <p>💡 Resend 是一款现代邮件 API 服务，每月 3000 封免费额度。</p>
        <p>
          1. 在 <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-pink-500 hover:underline">resend.com</a> 注册账号
        </p>
        <p>
          2. 添加并验证你的发件域名（或使用测试域名 <code className="text-pink-500">@resend.dev</code>）
        </p>
        <p>
          3. 在 API Keys 页面创建 API Key，填入下方
        </p>
      </div>

      {/* API Key */}
      <label className="space-y-1 text-sm font-medium block">
        <span className="flex items-center gap-1.5">
          <Key className="w-4 h-4 text-amber-500" />
          Resend API Key
        </span>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={settings.resend_api_key}
            onChange={(e) => updateSetting("resend_api_key", e.target.value)}
            className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5 pr-10 font-mono text-sm"
            placeholder="re_..."
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <span className="text-xs text-slate-400 mt-0.5 block">
          从 Resend Dashboard → API Keys 创建。以 <code>re_</code> 开头。
        </span>
      </label>

      {/* From */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="space-y-1 text-sm font-medium">
          发件人地址
          <input
            type="email"
            value={settings.from_addr}
            onChange={(e) => updateSetting("from_addr", e.target.value)}
            className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
            placeholder="onboarding@resend.dev"
          />
          <span className="text-xs text-slate-400 mt-0.5 block">
            未验证域名时可用 <code className="text-pink-500">onboarding@resend.dev</code> 测试
          </span>
        </label>
        <label className="space-y-1 text-sm font-medium">
          发件人名称
          <input
            type="text"
            value={settings.from_name}
            onChange={(e) => updateSetting("from_name", e.target.value)}
            className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
            placeholder="次元导航"
          />
        </label>
      </div>

      {/* Notification Settings */}
      <div className="pt-4 border-t border-white/30 dark:border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-5 h-5 text-amber-500" />
          <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
            通知设置
          </h3>
        </div>

        <label className="space-y-1 text-sm font-medium mb-4 block">
          管理员接收邮箱
          <input
            type="text"
            value={settings.admin_recipients}
            onChange={(e) => updateSetting("admin_recipients", e.target.value)}
            className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
            placeholder="admin@example.com, admin2@example.com"
          />
          <span className="text-xs text-slate-400 mt-0.5 block">
            多个邮箱请用逗号分隔。系统通知将发送到这些邮箱。
          </span>
        </label>

        <div className="liquid-chip rounded-2xl px-4 py-3 mb-3">
          <label className="flex items-start gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={settings.notify_on_submission}
              onChange={(e) => updateSetting("notify_on_submission", e.target.checked)}
              className="mt-0.5"
            />
            <span>
              用户提交建议/网址时发送通知
              <span className="block mt-1 text-xs font-normal text-slate-500">
                当用户在网站上提交新建议或推荐网址时，发送邮件通知管理员。
              </span>
            </span>
          </label>
        </div>

        <div className="liquid-chip rounded-2xl px-4 py-3">
          <label className="flex items-start gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={settings.notify_on_error}
              onChange={(e) => updateSetting("notify_on_error", e.target.checked)}
              className="mt-0.5"
            />
            <span>
              系统错误通知
              <span className="block mt-1 text-xs font-normal text-slate-500">
                当后台抓取或同步任务失败时发送错误通知。
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      {testResult && (
        <div className={`flex items-center gap-2 text-sm rounded-xl px-4 py-3 ${
          testResult.success
            ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20'
            : 'text-amber-600 bg-amber-50 dark:bg-amber-900/20'
        }`}>
          {testResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {testResult.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button type="submit" disabled={saving} className="liquid-button-primary flex items-center gap-2 px-5 py-2.5 font-medium text-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "保存中..." : "保存设置"}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testLoading}
          className="liquid-button flex items-center gap-2 px-5 py-2.5 font-medium text-sm text-emerald-600 dark:text-emerald-400"
        >
          {testLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          {testLoading ? "发送中..." : "发送测试邮件"}
        </button>
      </div>
    </form>
  );
}
