/**
 * 系统更新面板 - 重构版
 * 组合多个子组件，使用 UpdateProvider 统一状态管理
 */

import { UpdateProvider } from './updater/index.js';
import {
  UpdateStatusCard,
  UpdateChannelSelector,
  UpdateActions,
  UpdateProgress,
  UpdateMaintenanceWindow,
  UpdateSignatureKeys,
  UpdateNotificationConfig,
  UpdateAuditLog,
  UpdateSettings,
} from './updater/index.js';

export default function UpdateSystemPanel() {
  return (
    <UpdateProvider>
      <div className="liquid-panel rounded-[2rem] p-6 space-y-6">
        {/* 版本状态卡片 */}
        <UpdateStatusCard />

        {/* 更新通道选择器 */}
        <UpdateChannelSelector />

        {/* 更新操作按钮 */}
        <UpdateActions />

        {/* 更新进度（仅运行时显示） */}
        <UpdateProgress />

        {/* 维护窗口配置 */}
        <UpdateMaintenanceWindow />

        {/* 签名密钥管理 */}
        <UpdateSignatureKeys />

        {/* 通知配置 */}
        <UpdateNotificationConfig />

        {/* 审计日志 */}
        <UpdateAuditLog />

        {/* 综合设置 */}
        <UpdateSettings />
      </div>
    </UpdateProvider>
  );
}